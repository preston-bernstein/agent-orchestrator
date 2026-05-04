---
adr: 0001
created: 2026-05-04
updated: 2026-05-04
status: accepted
tags: [decision, adr, phase-9, o7, scorecard]
---

# ADR 0001: Phase 2 trigger evaluation — PoC mock-fixture pass + real-TF graduation gate

## Status

`accepted` — Phase 9 closeout (vault `Build/Playbook.md` §Phase 9). Re-opens automatically if any of the O7 bars regress on real-TF runs.

## Context

Vault `Build/Playbook.md` §Phase 9 demands a ½-day decision pass after Phase 8 scorecard lands: did the PoC clear the O7 numeric trigger (`Build/Patterns/O7-phase2-numeric-trigger.md`) — `green_pct >= 80 AND avg_fix_loops <= 1.5 AND audit_chain_break_count == 0` over ≥ 5 consecutive runs across scenarios A–E — or did some bar miss + need an O5 / O3 / O4 / O6 / O8 retrofit before Phase 2 work (per-stack second supervisors, edge-42 perf gates, plugin loading, Studio) starts?

PoC ran scenarios A–E end-to-end against mock TF + mock exec only (`MOCK_TF=1` lane; subagent real-TF wiring deferred per `tasks.md` task 53). The O7 trigger needs **real** runs against managed repos to graduate — synthetic mock fixtures can't substitute.

## Decision

1. **PoC scorecard bars are met on the synthetic surface.** All five demo scenarios (A spring API single-stack, B react UI-only, C cross-repo contract gate, D test-only change, E refactor no-op via O5 skip) ship as Vitest E2E mock fixtures in `tests/workflows/scenario{A,B,C,D,E}.test.ts`. Scorecard classifier (`src/scorecard/aggregate.ts` — `inferScenario` / `inferGreen` / `inferFixLoops`) reads audit JSONL, infers scenario id (heuristic w/ explicit `scenario=X` decision-token override), and emits `green_pct`, `avg_fix_loops`, `chain_breaks`, `phase_2_eligible` per O7. On the test fixtures: `green_pct = 100`, `avg_fix_loops = 0` (mock subagent converges on first gate), `chain_breaks = 0`. **Mock-surface verdict: phase_2_eligible:true.**
2. **Real-TF graduation is a separate gate.** Real-TF eligibility requires ≥ 5 consecutive runs against the registered managed repos (`ORCH_MANAGED_REPOS` → vault `_meta.md`) hitting the same bars. Sub-tasks: (a) wire real-TF subagent completion (currently `MOCK_TF=1` only; vault `tasks.md` task 53), (b) execute the supervisor branch against `spring-api` + `react-ui` worktrees, (c) re-run scoreboard, (d) bump this ADR's `status` if `phase_2_eligible:true` holds for 5 runs.
3. **No Phase 2 work begins until step (d).** Per `Build/Patterns/O7-phase2-numeric-trigger.md` the trigger fires on real artifacts, not synthetic ones. Phase 2 items (per-stack second supervisors, perf gates per edge 42, plugin loading, Studio) stay in `Examples/` design space.
4. **Wall-clock-vs-baseline bar (`Orchestration PoC Demo Scorecard.md` row 3) defers to real-TF runs.** Mock fixtures complete in <1s aggregate — meaningless against the "≤ baseline manual flow" standard. Captured in scorecard `manual_baseline_ms?` (optional) per vault `Scorecard Generator.md` schema; populated when real runs land.

## Consequences

- **Positive:** Phase 2 work stays gated behind a numeric, real-data check. PoC ships with explicit bar-evaluation infra (scorecard inference + tests) so the graduation step is a `pnpm run scorecard` re-run, not a re-design.
- **Positive:** Scenarios D + E now have first-class E2E coverage. Scenario E specifically exercises the O5 dry-run skip lane end-to-end through `runPlannerBranch` (planner LLM completion never invoked; audit chain valid; outcome `skipped`).
- **Negative:** Two scenarios (A and D) share an audit shape — single spring supervisor, no contract — and require an explicit `scenario=X` decision-token override to disambiguate (`tests/workflows/scenarioD.test.ts` writes a `scenario_tag` audit row). Future runs that don't tag will classify D as A. Acceptable for PoC; revisit if D becomes a primary fixture.
- **Negative:** Inngest absorption (vault `Inngest Integration Plan.md` I1–I6, `tasks.md` 35–46) remains HITL-deferred; Phase 2 trigger doesn't unblock it. Tracking `Orchestration PoC/Inngest Integration Plan.md`.
- **Neutral / accepted:** Mock-fixture wall-clock is not a meaningful Phase 2 input; explicit deferral.

## Alternatives considered

| Option | Why rejected |
| ------ | ------------ |
| Declare Phase 2 eligible on mock-only data | Violates O7 — trigger requires real runs across A–E. Mock pass is necessary, not sufficient. |
| Defer ADR until real-TF subagent lands | Loses the chunked-build cadence (vault `Build/Playbook Fidelity Plan.md`). PoC closes Phase 9 deliberately on synthetic bars + names the graduation gate; real-TF pass becomes a status bump, not a re-derivation. |
| Skip Scenario D / E E2E (mock-only via aggregate-test fixtures) | Vault Demo Scorecard requires rows for A–E; partial coverage means scoreboard `scenarios_seen` shows zeros and inference rules can't be exercised end-to-end. |

## Affected specs / areas

- `agent-orchestrator/docs/specs/2026-05-04-orchestrator-bootstrap/tasks.md` — Phase 8 closeout / Phase 9: scenarios D + E + scorecard classifier landed; ADR 0001 published; bars assessed on mock surface.
- `agent-orchestrator/src/scorecard/aggregate.ts` — `inferScenario` / `inferGreen` / `inferFixLoops` + `phase_2_eligible` field on `TotalsRollup`.
- `agent-orchestrator/src/scorecard/format.ts` — scoreboard markdown surfaces O7 trigger block + per-run `scenario` + `green` cells.
- `agent-orchestrator/tests/workflows/scenarioD.test.ts`, `tests/workflows/scenarioE.test.ts` — E2E mock fixtures.
- Vault `Build/Patterns/O7-phase2-numeric-trigger.md` — referenced as the canonical bar; this ADR is the orchestrator's first concrete eligibility note.
- Vault `Build/Playbook.md` §Phase 9 — done bar (decision note in `docs/decisions/`) satisfied by this ADR.

## References

- `Orchestration PoC/Build/Patterns/O7-phase2-numeric-trigger.md` — bar definition.
- `Orchestration PoC/Build/Scorecard Generator.md` — `RunMetrics` schema + `phase_2_eligible` JSON field.
- `Orchestration PoC/Orchestration PoC Demo Scorecard.md` — A–E scenario rows.
- `Orchestration PoC/Build/Playbook.md` §Phase 9 — done-bar.
