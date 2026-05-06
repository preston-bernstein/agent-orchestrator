---
spec: 2026-05-05-clean-code-enforcement
created: 2026-05-05
updated: 2026-05-05
tags: [spec, plan, quality, architecture]
---

# Plan — machine-enforced clean code

How each “clean code” bucket maps to **CI/tooling** vs **process**, using the existing pipeline (`pnpm run ci`, `eslint/core.config.mjs`, `eslint/sonar.*`, `.dependency-cruiser.js`, strict TypeScript). Implementation is incremental; this file is the source of truth for **what** to enforce and **where** it lives.

## Context

- **CI entrypoint:** `AGENTS.md` / `pnpm run ci` — typecheck, `lint:base` + `lint:sonar`, coverage, `deps:cruise`, debt/structure guards, Istanbul + fallow, Stryker T0 + wide.
- **Dep graph:** `.dependency-cruiser.js` extends `recommended-strict` with `not-to-unresolvable` removed (native addons). **`forbidden`** is dependency-cruiser’s name for “dependency patterns that must not exist”; failures break `deps:cruise`.

## 1. Already enforced (do not duplicate)

| Concern | Mechanism | Config / command |
| ------- | --------- | ---------------- |
| Types / compile-time honesty | TypeScript | `tsc --noEmit`; `strict`, `noUncheckedIndexedAccess` (`tsconfig.json`) |
| Size / branching (prod `src`) | ESLint core | `complexity` max 35; `max-lines-per-function` max 320 (`eslint/core.config.mjs`); tests exempt |
| Dead exports / unused deps | Fallow rules | `.fallowrc.json`; `pnpm run fallow` |
| Cycles / orphans / strict graph | dependency-cruiser | `recommended-strict` + TS options; `pnpm run deps:cruise` |
| Duplication | Fallow | `.fallowrc.json`, `scripts/fallow-with-coverage.mjs` |
| Behavior under change | Stryker | `stryker.conf.json`, `stryker.wide.conf.json` |

## 2. Layering / architectural boundaries

**Goal:** Encode allowed dependency direction between `src/**` areas (e.g. low-level run state must not import workflow orchestration).

**Enforcer:** dependency-cruiser **`forbidden`** rules in `.dependency-cruiser.js` (merged with the filtered `recommended-strict` list).

**Conventions:**

- Each custom rule: **`name`**, **`comment`** (one-line *why*), **`severity: error`**, **`from` / `to`** path globs.
- Prefer a small set of high-signal rules; expand when a real boundary exists (avoid inventing layers before code is split).
- If a rule is temporarily impossible, **do not** delete the intent — fix imports or add a **time-boxed** exception documented in the rule comment (see §6).

**Example shapes** (illustrative — validate against actual `src/` layout before enabling):

- `src/runs/**` must not depend on `src/workflows/**`.
- `src/cli/**` must not be imported by non-CLI packages except agreed entrypoints (often easier as “forbidden: `src/**` → `src/cli/**` except `orchestrate`” — use DC path constraints or split `cli` into `internal` vs `public`).

**CI:** Same slot as today; no new runner.

## 3. ESLint ratchet (incremental)

**Goal:** Tighten style and safety without a one-shot big bang.

| Tactic | Notes |
| ------ | ----- |
| Lower `complexity` / `max-lines-per-function` | Step down over PRs; use **per-file** overrides only for accepted debt. |
| `max-lines` per file | Optional; pair with refactors or narrow overrides. |
| `@typescript-eslint/no-explicit-any` | Start **warn** or **error** on `src/**` only; keep `tests/**` relaxed. |
| `no-restricted-imports` | Ban specific modules or patterns (e.g. centralize `node:fs` behind one module if that’s policy). |
| Duplication with dep-cruise | Prefer **one** owner for import direction (DC) vs ESLint for the same arc, unless ESLint catches dynamic requires DC misses. |

**Consistency:** Anything that must **hard-fail CI** should live in `lint:base` and/or `lint:sonar` deliberately (same as local `pnpm run lint` / `analyze:eslint` expectations).

## 4. Errors as data

**Goal:** Boundaries throw or return **typed, discriminated** errors; fewer opaque `throw new Error(\`…\`)` strings.

**Enforcers:**

- **Types:** Single exported error union / base class + narrow at call sites.
- **Tests:** Vitest on constructors, `instanceof` or discriminant, and stable **codes** where applicable (especially CLI exit paths and audit/scorecard surfaces).

**Optional (team agreement):** ESLint `no-restricted-syntax` on raw `throw new Error` in `src/**` — heavy-handed; only if noise is low.

## 5. Refactors (SRP, smaller modules)

**Goal:** Tooling cannot prove “one reason to change”; pair refactors with existing gates.

| Practice | Enforcer |
| -------- | -------- |
| Split hot files (e.g. workflow/supervisor paths) | Human design + review |
| New modules stay testable | Coverage + Stryker on touched code |
| New boundaries respected | dependency-cruiser rules from §2 |
| Optional ownership | `CODEOWNERS` for critical paths |

## 6. Exceptions and debt (must not rot)

**Policy:**

- No `eslint-disable`, `@ts-expect-error`, or dependency-cruiser carve-out without **comment + ticket** or **remove-by date** (`YYYY-MM`).
- Prefer fixing the root cause over widening ignores.

**Optional automation:**

- Small CI script: grep for disable/ignore patterns; fail if the **next line** does not match `TODO(` or an issue id pattern (e.g. `#\d+`, `ORCH-\d+`). Tune to avoid false positives on legitimate comments.

## 7. Summary

| Idea | Primary enforcer |
| ---- | ---------------- |
| Layering / AD boundaries | dependency-cruiser `forbidden` + `pnpm run deps:cruise` |
| Smaller functions/files | ESLint caps in `eslint/core.config.mjs` (tighten / per-dir) |
| Less `any` / loose edges | `no-explicit-any` (src), zod (or equivalent) at IO edges, tests |
| Typed errors | Types + Vitest at boundaries; optional ESLint |
| Documented debt | Comment + issue/date; optional CI grep |

**Highest leverage new work:** explicit **`forbidden`** layer rules in `.dependency-cruiser.js` — reuses existing CI, encodes architecture as failing import edges.

## 8. Suggested rollout tasks

1. **Done** — `layers.md`: inventory + mermaid intent map + table of enforced edges.
2. **Done** — Three `forbidden` rules in `.dependency-cruiser.js` (`runs`↛`workflows`, `util` leaf, `gates`↛`workflows`); `pnpm run deps:cruise` clean.
3. **Done** — `@typescript-eslint/no-explicit-any`: **`error`** on `src/**/*.ts` in `eslint/core.config.mjs` (tree had no explicit `any`; skipped warn phase).
4. **Done** — **`pnpm run debt:guard`** (`scripts/debt-guard.mjs`) in **`quality`** + first **`ci`** wave; scopes `src/`, `tests/`, `scripts/`, `eslint/` — `//` / single-line `/* … */` suppressions need excuse (TODO ticket, GH/ORCH id, remove-by, `/issues/n`).
5. **Done** — ESLint core caps tightened: **complexity 22**, **max-lines-per-function 160**; `orchestrate` + `aggregate` refactors to satisfy.
6. **Done** — **`CliArgError`** → **`src/errors/CliArgError.ts`**; **`policy/hitl`** no longer imports **`cli/`**; **`BootConfig`** exported from **`config/env.ts`** for typing.
7. **Todo** — Calendar nudge: further cap drops or `max-lines` per file when hot paths grow; optional JSON ignore policy if needed.

### References

- Layer diagram + roles: [`layers.md`](./layers.md)
- **Unified strict gates:** [`strict-profile.md`](./strict-profile.md)
- Rules live in [`.dependency-cruiser.js`](../../../.dependency-cruiser.js) (`layerForbidden`), [`eslint/core.config.mjs`](../../../eslint/core.config.mjs), and [`scripts/debt-guard.mjs`](../../../scripts/debt-guard.mjs).

## 9. Single strict profile (done)

Operational contract: **`strict-profile.md`**. Highlights: ESLint **`complexity` 10**, **`max-lines-per-function` 70**, Sonar cognitive **12**; Fallow **`maxCyclomatic` 10**, **`maxCognitive` 12**, **`production-dupes`**; **`health.ignore`** only for istanbul-blind tooling (`debt-guard`, `orchestrate`, `mockExecuteLane`); Fallow **`ignoreDependencies`** policy documented there.
