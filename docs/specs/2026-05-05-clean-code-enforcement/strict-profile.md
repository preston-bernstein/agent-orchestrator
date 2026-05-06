---
spec: 2026-05-05-clean-code-enforcement
updated: 2026-05-05
tags: [quality, lint, fallow]
---

# Single strict profile — who owns what

## Canonical (Istanbul-informed structure)

**Fallow `health`** (`.fallowrc.json`): **`maxCyclomatic` 10**, **`maxCognitive` 12** (paired with Sonar cognitive cap), **`maxCrap` 120**, with **`FALLOW_COVERAGE=coverage-istanbul/coverage-final.json`**. Runs on entries under **`src/**/*.ts`**, **`scripts/**/*.ts`**, **`tests/**/*.ts`**.

This is the **authoritative** gate for cyclomatic/cognitive/CRAP on those files once coverage exists.

### Health exceptions

| Path | Reason |
| ---- | ------ |
| **`scripts/debt-guard.mjs`** | Standalone script; not in Vitest graph. |
| **`src/cli/orchestrate/index.ts`** | Excluded from **`vitest` Istanbul** surface (see `vitest.config.ts` `coverage.exclude`) — CRAP unfair. |
| **`src/cli/mockExecuteLane.ts`** | Only reached from orchestrate; hits **0** in `coverage-final.json` while still being real code paths. |

### Refactor target

Prefer **narrow modules** (`rollupRow.ts`, `mockExecuteLane.ts`, `argv.ts`, …) so **ESLint**, **Sonar**, and **Fallow** agree without large `eslint-disable`/ignore lists.

---

## Fast local guardrails (CI early signal)

Aligned to the same intent as Fallow’s cyclomatic ceiling **10**:

| Tool | Scope | Setting |
| ---- | ----- | ------- |
| ESLint core | all `*.ts`/`*.tsx` (tests included) | **`complexity` max 10** |
| ESLint core | same | **`max-lines-per-function` max 70** |
| ESLint core | same | **`@typescript-eslint/no-explicit-any` error** |
| ESLint core | all `*.ts`/`*.tsx` (tests included) | **`max-lines` max 400 (hard error)** |
| size-guard | `src` + `tests` + `scripts` JS/TS files | **target `<=120` lines per file** (hard-fail for non-allowlisted files) |

| SonarJS | all `*.ts`/`*.tsx` (tests included) | **`cognitive-complexity` max 12** |

Sonar cognitive **12** is stricter than the old **45** default; scales differ slightly from Fallow’s cognitive metric — **same order of magnitude** as “small functions.”

---

## Duplication

**Fallow `duplicates`**: **`mode` strict**, **≥5-line** clones on **production-scoped** analysis (**`--production-dupes`** in `scripts/fallow-with-coverage.mjs`) so workflow **test harness** clones do not overwhelm the gate. CI stays **fast**.

---

## Unused code / deps

### Fallow `ignoreDependencies`

Also includes **stryker-runtime** deps Fallow treats as dynamically used but statically invisible:

```json
[
  "@mastra/core",
  "@stryker-mutator/typescript-checker",
  "@stryker-mutator/vitest-runner",
  "@vitest/coverage-istanbul",
  "fallow",
  "madge"
]
```

When adding Mastra shim / infra-only packages, extend this list when the package is wired only via config executors (**Stryker**, etc.).

---

## Graph + layers

**.dependency-cruiser.js** `layerForbidden` + **`recommended-strict`** (minus native resolve quirk) — architectural direction, not duplicated by fallow.

---

## Debt suppressions

**`pnpm run debt:guard`** — `// eslint-disable*` / `@ts-expect-error` etc. must carry **TODO / issue id / remove-by** nearby (`scripts/debt-guard.mjs`).
