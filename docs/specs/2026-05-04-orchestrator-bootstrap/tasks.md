---
spec: 2026-05-04-orchestrator-bootstrap
created: 2026-05-04
updated: 2026-05-04
tags: [spec, tasks]
---

# Tasks — Orchestrator bootstrap

Mirrors vault `Examples/docs/specs/2026-05-02-orchestrator-bootstrap/tasks.md`. Tick boxes reflect **this repo's** state, not vault Examples state. "Landed in vault as Examples …" notes preserved as canon pointers.

Each task = one PR (or sub-PR per Playbook B1). Agent reads top-down, picks first unblocked, lands it, ticks the box. Human ticks between phases per Playbook **C1–C5** + Fidelity Plan §C.

## Pre-flight

- [x] 1. Read `requirements` + `design`.
- [x] 2. Confirm spec is `active` in `_active.md`.
- [ ] 3. Create branch `feat/orch-bootstrap-1` (working on `main` until cut for PR).

## Implementation

- [~] 4. Init `package.json` + `tsconfig.json` + `pnpm-lock.yaml` w/ pinned `@mastra/*` deps. Tests: smoke (`pnpm install` exits 0). _Phase 0 closes by adding `@mastra/core`, `p-limit`, `@toon-format/toon`._
- [x] 5. Add `.env.example` + `src/config/env.ts` w/ Zod-validated `BootConfig`. Tests: missing `TF_BASE_URL` fails boot; full env passes. _Phase 3 close: `requireTfConfig` refusal helper + `tests/config/env.test.ts` landed; `.env.example` marks TF_BASE_URL/TF_API_KEY required for orchestrate._
- [x] 6. Add `src/tf/client.ts` w/ `fetch`-based wrapper + capability probe. Tests: hostname check, mocked OK + 5xx + auth-error paths. _Phase 3 close: `TfClient` w/ pinned-host egress guard, Bearer auth, typed errors (`TfHostMismatchError`, `TfAuthError`, `TfHttpError`, `TfNetworkError`), `/v1/models` probe; `tests/tf/client.test.ts` covers all paths. Probe path final-confirm pending TF endpoint docs._
- [x] 7. Add `src/audit/jsonl.ts` w/ chained writer (canonical JSON + SHA-256 prev_hash). Tests: chain verify, key-order independence, secret-redaction guard. **Phase 2.**
- [x] 8. Add `src/audit/verify.ts` CLI: `pnpm run audit:verify <path>` returns ok / break-at-record-N. **Phase 2.**
- [x] 9. Add `src/runs/state.ts` w/ atomic tmp→rename writer (edge 44). **Phase 2.**
- [~] 10. Add `src/cli/orchestrate.ts` (Mastra workflow CLI entry). _Stub landed in commit 1507957. Phase 3 close: `requireTfConfig` refusal + TF capability probe wired (`TF_SKIP_PROBE=1` opt-out for CI/offline). Phase 4 close: `--dry-plan` / `--execute` flags + `--spec <path>` (single .md fixture or dir) + planner-branch workflow (`caveman → O5 → planner → plan.json + audit`); `MOCK_TF=1` skips boot probe + uses `mockPlannerCompletion` fixture. Phase 5: `runSupervisorBranch` lands (tasks 47–52) but **not yet auto-wired** into CLI execute lane — caller invokes directly w/ `cwds` map + subagent/fix-subagent/exec deps. CLI wiring + Mastra workflow wrapper lands Phase 5+ E2E (first real managed-repo)._
- [x] 11. Add `specs/no-op.md` so `pnpm run orchestrate -- --spec specs/no-op.md` has something to read. _Phase 4: single-file fixture (all `[x]` boxes); `loadSpec()` treats `.md` arg as 3-paths-same fixture; smoke run exits 0 + emits `runs/<id>/plan.json` + audit chain valid (3 records: `planner_branch:start`, `planner_emitted`, `dry_plan`)._
- [~] 12. Add `README.md` boot section. _Stub landed; full PLAYBOOK_EXPECTS yaml block lands Phase 0 close._

## Phase 5 — first supervisor + subagent (Playbook §Phase 5)

Vault canon: `Build/Playbook.md` §Phase 5; `Build/Prompts/{supervisor,subagent,fix-subagent}-base.md`; `Build/Prompts/Stacks/java-spring.md`. **Inngest (tasks 35–46)** stays HITL-deferred per Playbook ("Inngest optional; decision deferred until Phase 5 entry"). Phase 5 lands the deterministic supervisor lane first; Inngest absorbs durability behind ADR 0003 + 37a outbound gate.

- [x] 47. `src/stacks/{types,javaSpring,index}.ts` — `StackProfile` + `java-spring` mirror of vault overlay (`installCmd`, `qualityFastCmd`, `coverageFloor=0.80`, `mutationFloor=0.65`, `snapshotForbiddenFlags`). Tests: profile shape, registry lookup, `UnknownStackError`.
- [x] 48. `src/agents/{supervisor,subagent}.schema.ts` + `src/agents/{subagent,fixSubagent}.ts` — Zod outputs (O1) + generic agents per `Build/Prompts/{supervisor,subagent,fix-subagent}-base.md`. Tests: schema rejects rationale > 200 chars + unknown status; `enforceFilesTouched` (post-LLM scope), `enforceSnapshotFlagBan` (post-LLM `-DskipTests`); fix-subagent `fix budget exceeded` refusal at `attempt > max_fix_loops`. **Real TF wiring still mock (`MOCK_TF=1`); Phase 5+ E2E flips.**
- [x] 49. `src/gates/runQuality.ts` — `StackProfile` dispatch (`preflight` / `fast` / `heavy`), log tail (200, edge 3), OOM (edge 19) + `timed_out` flags, exec injection seam. Tests: cmd selection per kind, log truncation, oom/timeout propagation.
- [x] 50. `src/agents/supervisor.ts` — orchestrate subagent → gate → fix-loop. Path overlap refusal (vault §Behavior #1) before any LLM call; O3 supervisor budget cap; `attempt_counter` tracking; cycle guard via `visited_nodes` push + `graph_depth_cap` (edge 32) → `CycleAbortError`. Final-status priority: `budget_exhausted` > `needs_human_clarify` > `done`. `pending_diff_path` written to `runs/<id>/<sup>/pending.diff` only when all tasks green.
- [x] 51. `src/workflows/supervisorBranch.ts` — read `PlannerOutput`, group by supervisor id (`spring`/`react`/`orch`), dispatch `runSupervisor` per group; audit `supervisor_spawn` / `gate_invocation` (per call) / `supervisor_done`. **Phase 5 known gap:** `runPlannerBranch` execute lane still returns `execution_started` w/o auto-spawning supervisors — CLI integration lands w/ first real managed-repo (Phase 5+ E2E + Inngest tasks 38–39 if adopted). `supervisorSpawnGuard` abuse-test still defends raw spawn.
- [x] 52. Scenario A integration test (`tests/workflows/supervisorBranch.test.ts`) — java-spring single-task plan + mock TF (`mockSubagent` / `mockFixSubagent`) + mock gate exec; asserts plan→supervisor→subagent→gate green; `pending.diff` written; audit chain valid; fix-loop converges (gate red → fix → gate green); `max_fix_loops=2` ⇒ aggregate `budget_exhausted` w/ `attempt_counter=3` + 3 `gate_invocation` audit rows; missing `cwds[supervisor]` ⇒ `UnknownSupervisorCwd`.

## Cross-repo

- (none — no `pair_slug` set)

## Self-fidelity parity (orchestrator mirrors vault plan)

Vault plan + HITL between chunks: `Orchestration PoC/Orchestrator Self-Fidelity Parity.md`. Human ticks **SF1…SF6** there after each chunk gate **before** treating next tasks as unblocked for merge narrative.

### SF1 — expectations boot (**A3**)

- [x] 21. Add `src/config/expectations.ts` — parse `docs/playbook-expectations.md` (YAML + body); `loadExpectations()` w/ Zod. Tests: fixture file → ok; missing → documented warn path. _Landed commit 1507957._
- [x] 22. Wire `loadExpectations()` into boot (`src/cli/orchestrate.ts`) before TF probe. _Landed commit 1507957 (orchestrate stub calls loader)._
- [x] 23. Extend `RunContext` (Zod) w/ `expectations_snapshot`. Persist on run init. **Phase 2.** _Schema + `initRunContext()` factory landed in `src/runs/orchestratorContext.ts` per vault `<stack>Context.ts` extend rule; state.json roundtrip test green. CLI `src/cli/orchestrate.ts` will call `initRunContext()` + `atomicWriteJson` once a run loop exists in Phase 3+._
- [~] 24. Env `STRICT_EXPECTATIONS` + optional `EXPECTED_VAULT_SHA` — when set, boot **throws** if snapshot ≠ env. _`assertVaultShaAllowed` landed commit 1507957; throw-on-mismatch test landed; orchestrator-state wiring lands Phase 2._

### SF2 — O5 deterministic lane

- [x] 25. Implement `plannerDryRun()` per vault `Build/Patterns/O5-planner-dry-run.md`. _Landed `src/planner/plannerDryRun.ts` w/ injection seams (`gitStatus`, `readTasks`); `tests/planner/plannerDryRun.test.ts` covers 10 branches: all-checked + clean ⇒ skip; open `[ ]` / `[~]` / missing tasks.md ⇒ no skip; dirty tree ⇒ no skip; prior fix-loop ⇒ no skip; multi-spec OR semantics._
- [x] 26. Insert pre-planner workflow step. _Landed `src/workflows/plannerBranch.ts`: `plannerDryRun` runs before TF; `skip:true` ⇒ audit `planner_skipped` + return early (no completion call). Test `runPlannerBranch — O5 skipped_no_change_needed` asserts completion never invoked._

### SF3 — A4 `--dry-plan` / `--execute`

- [x] 27. CLI flags `--dry-plan` + `--execute`. _Landed `src/cli/args.ts` (mutex check, `ORCH_DRY_PLAN=1` env opt-in, `--reason` for Phase 7); `tests/cli/args.test.ts` 10 cases incl. mutex + env flag interaction._
- [x] 28. Persist `runs/<run_id>/plan.json`; dry-plan stops before supervisors. _`runPlannerBranch` writes plan via `atomicWriteJson`; on `dry_plan` outcome audits `dry_plan` event + returns; on `execute` audits `execution_started` (Phase 5 wires actual supervisors)._
- [x] 29. Integration test: `--dry-plan` ⇒ zero managed-repo subprocess. _Structural proof via `dryRunDeps` injection seam (`gitStatus` / `readTasks` fakes ⇒ zero `child_process` from `plannerDryRun`); workflow code itself contains no managed-repo spawn; audit asserts `dry_plan` present + `execution_started` absent + no `supervisor_spawn` event. Paired w/ task 34 abuse guard._

### SF4 — assembler allow-list (MVP)

- [x] 30. `src/llm/assemblePrompt.ts` — reject if globs ∉ `path_ownership_map`. _Landed `src/llm/{assemblePrompt,toonContext}.ts`; assembly order matches `Build/Prompts/Index.md` (caveman → TOON → base → stack → context → XML → schema); `PathOwnershipViolation` on declared-path miss; `PromptBudgetError` on est > `ORCH_MAX_PROMPT_TOKENS` (default 100k); minimal `globMatch` w/ `**` + `*`. 13 tests + 6 TOON round-trip tests._

### SF5 — HITL policy hook (**C1–C5**)

- [ ] 31. `src/policy/hitl.ts` — signal mapping + audit `hitl_escalation`. **Phase 7 (approval).**
- [ ] 32. `--danger-apply` requires `--reason`. **Phase 7.**

### SF6 — telemetry + abuse

- [ ] 33. Audit rollup / `pnpm run scorecard` counters. **Phase 8.**
- [x] 34. Abuse vitest: supervisor spawn throws if `!cli_flags.execute`. _Landed `supervisorSpawnGuard()` in `src/workflows/plannerBranch.ts`; throws `SupervisorNotWiredError` unless `cli_flags.execute === true` (`undefined`, `false`, truthy strings all refused); test cases cover 4 negative + 1 positive._

## Inngest integration (durable outer DAG — self-hosted only)

Vault chunk + HITL + license/outbound posture: `Orchestration PoC/Inngest Integration Plan.md`. Tick **I1…I6** there between PR groups. **Mastra stays inside** `step.run`. **Inngest Cloud rejected**. Mastra suspend/resume **dropped** (Inngest `waitForEvent` owns HITL).

Per Playbook Phase 5: "**Inngest (optional):** if org uses Inngest+Mastra, land **I1–I3** before Scenario A E2E." Decision deferred until Phase 5 entry.

### I1 — ADR

- [ ] 35. Mirror vault Examples ADR 0003 → `docs/decisions/2026-MM-DD-0003-inngest-outer-durable-shell.md`. _Landed in vault Examples 2026-05-03; orchestrator mirror at Phase 5 entry._

### I2 — Dev deps + serve + outbound verification (gate)

- [ ] 36. Add `inngest` pkg + `src/inngest/{client,serve}.ts`. _Vault RepoKit starters landed 2026-05-03; orchestrator copy at Phase 5 entry._
- [ ] 37. `.env.example` + `BootConfig` Inngest vars + README run-dev section. _Vault RepoKit starters landed 2026-05-03._
- [ ] 37a. **Outbound verification gate** — DoD checklist (source grep + tcpdump 3 windows + telemetry-disable env vars + ADR appendix). _Vault verdict GREEN-caveated 2026-05-03 against server commit `acbefdc7`; tcpdump deferred to pre-prod. Re-run on prod binary before ADR 0005 promotion._

### I3 — First function

- [ ] 38. `orch-run` Inngest function listening on `orch/dry-plan.requested` + `orch/run.requested`. _Vault RepoKit starter landed 2026-05-03; orchestrator copy at Phase 5 entry._
- [ ] 39. Per-supervisor `step.waitForEvent('orch/approve.<sup>')` between pre-approval + resume. _Vault RepoKit starter landed 2026-05-03._

### I4 — Retries + idempotency

- [ ] 40. TF fetch wrapper: cache `(runId, agentName, promptHash) → response`; `retries: 2` per `step.run`. _Vault RepoKit starters landed 2026-05-03 (`tf-cache.ts.starter` + tests + better-sqlite3)._

### I5 — Observability (both sinks)

- [ ] 41. Mirror vault Examples ADR 0004 → `docs/decisions/2026-MM-DD-0004-observability-split.md`. _Vault Examples landed 2026-05-03._

### I6 — Self-host prod path (defer)

- [ ] 42. Mirror vault Examples ADR 0005 → `docs/decisions/2026-MM-DD-0005-inngest-self-host-prod-target.md` (status `proposed`). _Vault Examples landed 2026-05-03._

### Inngest absorption (delete or thin existing hand-roll)

- [ ] 43. Drop `p-limit` LLM concurrency cap; declare `concurrency` / `throttle` / `rateLimit` on `orch-run`.
- [ ] 44. Drop per-repo `.agent-orchestrator.lock` (edge 40); replace w/ Inngest fn `concurrency: { key: 'event.data.runId+repo' }`.
- [ ] 45. Drop `--resume <runId>` CLI flag (edge 11); resume = re-emit same event id.
- [ ] 46. Mark deprecated `src/runs/state.ts` atomic writer outside non-Inngest local mock CLI path (edge 44).

## Verification

- [ ] 13. `pnpm run quality` green (tsc + ESLint `--max-warnings=0` + Vitest).
- [ ] 14. Coverage threshold met: `src/audit/**` ≥ 90%; rest ≥ 70%.
- [ ] 15. Stryker scoped to `src/audit/**` ≥ 80% mutation.
- [ ] 16. Egress allowlist test: only TF base URL hit during full test run.
- [ ] 17. Reviewer agent / human approves diff (per-supervisor approval).

## Wrap

- [ ] 18. Update `_active.md` — move spec to `done`.
- [ ] 19. Update `_index.md` — set `Merged: <date>`.
- [ ] 20. File ADR if anything architectural surfaced.

## Blockers

| Task # | Blocked by | Owner | Note |
| ------ | ---------- | ----- | ---- |
| 6 (probe path final-confirm) | TF capability probe response shape | Preston | `/v1/models` chosen as PoC probe; re-confirm vs TF endpoint docs once landed |
| 7 | hash algorithm choice (SHA-256 vs Blake3) | Preston | leaning SHA-256 (stdlib) |
| 21–34 (self-fidelity) | Vault **SF\*** HITL ticks | Preston | `Orchestrator Self-Fidelity Parity.md` |
| 35–46 (Inngest) | Vault **I\*** HITL ticks; **37a outbound gate** blocks I3 merge | Preston | optional per Playbook Phase 5 |
