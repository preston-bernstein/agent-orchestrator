---
created: 2026-05-05
status: drafted
target_score: ≥95% (from 88.61% baseline)
scope: 29 residual mutation survivors after Phase 11 expansion (commit 8c062db)
report: reports/mutation/mutation.json
tags: [stryker, mutation-testing, working-plan]
---

# Stryker survivor elimination — working plan

Working plan for closing the 29 residual mutation-test survivors landed in commit `8c062db` ("test(stryker): expand mutation scope to security-adjacent surfaces"). Companion to `docs/specs/2026-05-04-orchestrator-bootstrap/tasks.md` task 15 close note (Phase 11 + scope expansion addendum).

**Baseline:** 88.61% (245/277 killed) across 7 files. Per-file: env.ts + cache.ts 100%, hitl.ts 92.86%, args.ts 90.70%, jsonl.ts 88.89%, assemblePrompt.ts 84.75%, client.ts 80.39%.

**Honest framing:** 88.61% already clears the 80% break threshold. The next 11pts costs real effort and some refactor risk. Each phase below has a clean bail-early checkpoint — run phase 0 first, then decide whether phases 2–3 are worth the cost given current PoC stage.

## Phase 0 — Inventory (read-only, ~20min)

Parse `reports/mutation/mutation.json` for all 29 survivors. Classify each into one of four buckets and write a one-line entry per survivor.

| Class | Meaning | Phase |
| ----- | ------- | ----- |
| **A** | Missing kill test — additive, zero source change | 1 |
| **D** | Adversarial-input gap — tighten existing test fixtures | 1 |
| **C** | Dead code — verified unreachable, can be removed | 2 |
| **B** | Equivalent paths — produces identical observable output, requires refactor or per-line Stryker disable | 3 / 4 |

**Output:** `docs/plans/2026-05-05-stryker-survivor-elimination.inventory.md` (one block per survivor: file:line, mutator type, replacement, classification, recommended action).

**Checkpoint:** Review inventory before any code touch. Likely ≥ half the 29 are class A/D (cheap kills); the remaining 10–12 are the judgment-call mutants.

## Phase 1 — Class A + D (additive tests, ~1hr)

Write missing kill tests and add adversarial-input variants (empty arrays, mixed-type entries, `null` bodies, whitespace-padded strings, etc.).

- **No source changes** — purely test additions.
- **Risk: zero** — functionality cannot regress from added tests.
- Re-run `pnpm run mutation` after each batch.

**Checkpoint:** Score after batch. Likely lands ~93–95%.

## Phase 2 — Class C (dead-code excision, ~1hr)

For each mutant in genuinely unreachable code:

1. Grep + V8 coverage prove no caller reaches the line.
2. Delete the code.
3. `pnpm run quality` must stay green.
4. Re-run `pnpm run mutation`.

- **Risk: low** — verified unreachable, but each excision lands as its own commit so revert is a one-line `git revert`.

**Checkpoint:** Each commit reviewable independently.

## Phase 3 — Class B refactor (most invasive, ~2hr)

Structural-symmetry survivors (e.g. `redactValue` array branch is functionally redundant with the object branch via `Object.values`; `new URL(abs, base)` ignores `base` when `abs` is absolute per WHATWG URL spec).

Per survivor:

1. **Lock current behavior** — write a property/round-trip test that pins the externally-observable output across all input shapes that reach this code path.
2. Refactor to a single canonical path.
3. Property test still green ⇒ no regression.
4. Re-run `pnpm run mutation`.

- **Risk: medium** — refactor can introduce subtle bugs. The property test is the safety net; commit per refactor for easy revert.
- **Bail option:** If any property test goes red mid-refactor, revert and fall through to Phase 4 for that mutant.

**Checkpoint:** Each refactor = one commit.

## Phase 4 — Per-line Stryker disable for proven equivalents (~30min)

For mutants that **provably** produce identical observable output under all reachable inputs (worth documenting because "we can't kill this with citation" beats "we forgot"):

```ts
// Stryker disable next-line ConditionalExpression: new URL(abs, base) ignores base when abs is absolute per WHATWG URL spec — branches produce identical Resolution
const target = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
  ? new URL(pathOrUrl)
  : new URL(pathOrUrl, this.base);
```

- Each disable comment must cite a spec, RFC, or invariant — not "trust me."
- **Risk: zero** — only Stryker config; source behavior unchanged.

**Checkpoint:** Review disable comments — each must have a citable reason.

## Phase 5 — Re-baseline + commit (~15min)

1. Final `pnpm run mutation`.
2. Update `docs/specs/2026-05-04-orchestrator-bootstrap/tasks.md` task 15 close note with new score + per-file table.
3. Commit + push.

## Bail-early checkpoints

| After phase | Expected score | Decision point |
| ----------- | -------------- | -------------- |
| 1 | ~93–95% | Stop here if good enough — pure test additions, no risk taken. |
| 2 | ~95–96% | Dead-code removal also low-risk; sensible stopping point. |
| 3 | ~98%+ | Refactor risk taken — only worth it if mutation gate ROI is high. |
| 4 | 100% (modulo new code) | Documented gate; ongoing maintenance cheap. |

## Hard constraints

- **No functionality regressions.** Every phase preserves externally-observable behavior. Phases 1–2 are additive/excisive; phase 3 is refactor-with-property-test-pin; phase 4 changes nothing.
- **One commit per phase batch.** Easy revert path if any phase introduces unexpected breakage downstream.
- **Re-run quality + mutation after each batch.** Don't let drift accumulate.
- **No `--no-verify` skips.** If a hook fails, fix the underlying issue.

## Tied to

- `docs/specs/2026-05-04-orchestrator-bootstrap/tasks.md` task 15 (Stryker mutation gate close note).
- `stryker.conf.json` (mutate glob + `mutator.excludedMutations: ["StringLiteral"]`).
- `reports/mutation/mutation.{html,json}` (gitignored — regenerate via `pnpm run mutation`).
