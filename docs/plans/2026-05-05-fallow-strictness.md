---
created: 2026-05-05
status: phase 4 step 1 complete (50/30); step 2 blocked on runSupervisor refactor
scope: Align fallow CI gate with coverage (90/85 floors) + Stryker wide (break ≥ 95%) in strictness of posture, not numeric score
config: .fallowrc.json
tags: [fallow, static-analysis, ci, technical-debt, working-plan]
---

# Fallow strictness — working plan

Fallow measures **reachability, duplication, complexity caps, and dependency hygiene** — not a 0–100 score like coverage or mutation testing. “Feels as strict” means **`fallow --ci` fails on structural debt** and **`health.ignore` stays small and justified**, comparable to how few files are excluded from Stryker’s wide glob.

**Reference gates (this repo):** `vitest.config.ts` coverage thresholds (default **90/90/90 lines·stmts·funcs**, **85 branches**; tiered overrides). `stryker.wide.conf.json` **break ≥ 95%**.

## Principles

1. **Different metric, same bar:** Strictness = what fails CI + how little is ignored.
2. **One knob per phase:** Each phase should be mergeable; avoid flipping ten settings at once.
3. **Inventory before tightening:** Count findings by `ruleId` so work is ordered and measurable.

## Phase 0 — Baseline (half day)

- Run fallow with machine-readable output (e.g. SARIF) and **group by `ruleId` and severity**.
- Snapshot at least:
  - `fallow/code-duplication` (often warning under mild + high threshold)
  - `fallow/high-cognitive-complexity`, `fallow/high-cyclomatic-complexity`, `fallow/high-complexity`, `fallow/high-crap-score` on **non-ignored** files
  - `fallow/unused-*` (many configured as warn today)
  - `fallow/untested-file`, `fallow/untested-export` if present and actionable
- **Policy decision:** Prefer promoting specific rules to **error** over “treat all warnings as failure,” so SARIF levels stay honest.

**Exit:** Table of counts per rule; agreement that later phases will intentionally make CI red until cleaned or explicitly suppressed.

## Phase 1 — CI semantics (small config change)

- In `.fallowrc.json` **`rules`:** promote to **`error`** (where schema supports) for:
  - `unused-dependencies` / `unused-dev-dependencies` after `ignoreDependencies` is accurate
  - optionally `unused-class-members` if noise is low
- **Duplication:** After Phase 0 counts, move **`duplicates.mode`** toward **`strict`** and/or **lower `threshold`** (e.g. 15 → 12); only as far as the team will fix in the next sprint.
- **Docs:** Note in `AGENTS.md` (or here only) that fallow strict = duplication + deps + complexity on non-ignored paths.

**Exit:** `pnpm run fallow` fails CI on at least one intentional class (e.g. duplication or deps), not only hard dead-code errors.

## Phase 2 — Duplication budget (code work)

- Drive **`fallow/code-duplication`** to **zero at the chosen bar** (extract helpers, dedupe tests/glue).
- Intentional clones: **narrow** suppressions or patterns — not broad `ignorePatterns` for hand-wavy dirs.

**Exit:** Clean at the new duplication settings; optional second tightening (e.g. threshold 12 → 10) later.

## Phase 3 — Shrink `health.ignore` (largest “feel strict” lever)

- Treat entries like Stryker excludes: **temporary, with intent to delete**.
- Per file: **refactor or split** until under caps; order **small/leaf files first**, orchestration-heavy files last.
- Optional: add a column in a small table (file → reason → target) appended below as work proceeds.

**Exit:** Ignore list materially shorter (e.g. half the paths removed, or only N accepted paths with written rationale).

## Phase 4 — Tighten complexity caps (incremental)

- After ignores shrink, **lower caps in steps**, e.g. **55/35 → 50/30 → 45/28** (cognitive / cyclomatic), only when the codebase already sits below the next cap so each PR stays green.
- **`maxCrap`:** tighten mainly **after** Phase 5 (real coverage input); otherwise CRAP is weaker signal.

**Exit:** Caps match “review-sized” functions for most of `src/`.

## Phase 5 — Pair with Vitest coverage (optional, strong alignment)

- Run fallow with **coverage integration** (project flag + Vitest **LCOV**) so **CRAP** reflects actual test strength, aligned with `vitest.config.ts`.
- Then lower **`maxCrap`** gradually (e.g. 120 → 100 → 80) on paths that are not ignored.

**Exit:** Complex, undertested code is flagged similarly to weak mutation survival.

## Phase 6 — Guardrails

- **PR policy:** New `health.ignore` or duplicate suppressions need **issue link or removal date**.
- **Quarterly:** Drop duplication threshold or remove another ignore bucket.

## Success criteria

- **`fallow --ci` fails** on duplication, dependency hygiene, and complexity violations for **non-ignored** production paths.
- **`health.ignore` is short and justified** — not a parallel “T3 exclude list.”
- **Unused dependency / class-member** rules are **error** (or documented warn with a sunset date).

## Risks

- **Noise:** Stricter dependency rules need accurate `ignoreDependencies` (framework plugins, Stryker packages, etc.).
- **Effort:** Phases 2–3 dominate calendar time; Phase 1 is the commitment lever.

## Related

- `docs/plans/2026-05-05-stryker-survivor-elimination.md` — mutation survivor work (orthogonal but same “tighten the fence” theme).
- `.fallowrc.json` — live configuration.
