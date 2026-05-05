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
- [x] 3. Create branch `feat/orch-bootstrap-1` (working on `main` until cut for PR). _Branch cut 2026-05-04 at HEAD `1e10e94` (post Phase 11 mutation gate); origin/main already carries Phases 1–11 — wrap PR contains admin only (tasks.md ticks + `_active.md` move + `_index.md` no-op until merge)._

## Implementation

- [x] 4. Init `package.json` + `tsconfig.json` + `pnpm-lock.yaml` w/ pinned `@mastra/*` deps. Tests: smoke (`pnpm install` exits 0). _Phase 0 close: `@mastra/core`, `p-limit`, `@toon-format/toon`, `zod` in `dependencies`. Phase 10 close: ESLint + typescript-eslint + `@vitest/coverage-v8` added to `devDependencies` (`pnpm@9.15.0` packageManager pin retained)._
- [x] 5. Add `.env.example` + `src/config/env.ts` w/ Zod-validated `BootConfig`. Tests: missing `TF_BASE_URL` fails boot; full env passes. _Phase 3 close: `requireTfConfig` refusal helper + `tests/config/env.test.ts` landed; `.env.example` marks TF_BASE_URL/TF_API_KEY required for orchestrate._
- [x] 6. Add `src/tf/client.ts` w/ `fetch`-based wrapper + capability probe. Tests: hostname check, mocked OK + 5xx + auth-error paths. _Phase 3 close: `TfClient` w/ pinned-host egress guard, Bearer auth, typed errors (`TfHostMismatchError`, `TfAuthError`, `TfHttpError`, `TfNetworkError`), `/v1/models` probe; `tests/tf/client.test.ts` covers all paths. Probe path final-confirm pending TF endpoint docs._
- [x] 7. Add `src/audit/jsonl.ts` w/ chained writer (canonical JSON + SHA-256 prev_hash). Tests: chain verify, key-order independence, secret-redaction guard. **Phase 2.**
- [x] 8. Add `src/audit/verify.ts` CLI: `pnpm run audit:verify <path>` returns ok / break-at-record-N. **Phase 2.**
- [x] 9. Add `src/runs/state.ts` w/ atomic tmp→rename writer (edge 44). **Phase 2.**
- [x] 10. Add `src/cli/orchestrate.ts` (Mastra workflow CLI entry). _Stub landed in commit 1507957. Phase 3 close: `requireTfConfig` refusal + TF capability probe wired (`TF_SKIP_PROBE=1` opt-out for CI/offline). Phase 4 close: `--dry-plan` / `--execute` flags + `--spec <path>` (single .md fixture or dir) + planner-branch workflow (`caveman → O5 → planner → plan.json + audit`); `MOCK_TF=1` skips boot probe + uses `mockPlannerCompletion` fixture. **Phase 5 closeout:** CLI execute lane auto-wires `runExecuteLane` → `runSupervisorBranch` w/ `loadManagedRepos(ORCH_MANAGED_REPOS)` (vault `_meta.md` per repo); `MOCK_TF=1` lane uses `mockSubagent` / `mockFixSubagent` / `mockExec`; real-TF subagent completion not wired (Phase 5+ first real managed-repo). Mastra workflow wrapper still deferred — straight async lanes for now._
- [x] 11. Add `fixtures/no-op.md` so `pnpm run orchestrate -- --spec fixtures/no-op.md` has something to read. _Phase 4: single-file fixture (all `[x]` boxes); `loadSpec()` treats `.md` arg as 3-paths-same fixture; smoke run exits 0 + emits `runs/<id>/plan.json` + audit chain valid (3 records: `planner_branch:start`, `planner_emitted`, `dry_plan`). **Folder renamed `specs/ → fixtures/` 2026-05-04** — disambiguates from `docs/specs/` (work-spec canon). Vault Examples still says `specs/`; mirror divergence noted here._
- [x] 12. Add `README.md` boot section. _Stub landed; full `PLAYBOOK_EXPECTS` yaml block + Scripts table refresh w/ `quality` / `coverage` / `lint` / `audit:verify` / `scorecard` landed Phase 10 close._

## Phase 5 — first supervisor + subagent (Playbook §Phase 5)

Vault canon: `Build/Playbook.md` §Phase 5; `Build/Prompts/{supervisor,subagent,fix-subagent}-base.md`; `Build/Prompts/Stacks/java-spring.md`. **Inngest (tasks 35–46)** stays HITL-deferred per Playbook ("Inngest optional; decision deferred until Phase 5 entry"). Phase 5 lands the deterministic supervisor lane first; Inngest absorbs durability behind ADR 0003 + 37a outbound gate.

- [x] 47. `src/stacks/{types,javaSpring,index}.ts` — `StackProfile` + `java-spring` mirror of vault overlay (`installCmd`, `qualityFastCmd`, `coverageFloor=0.80`, `mutationFloor=0.65`, `snapshotForbiddenFlags`). Tests: profile shape, registry lookup, `UnknownStackError`.
- [x] 48. `src/agents/{supervisor,subagent}.schema.ts` + `src/agents/{subagent,fixSubagent}.ts` — Zod outputs (O1) + generic agents per `Build/Prompts/{supervisor,subagent,fix-subagent}-base.md`. Tests: schema rejects rationale > 200 chars + unknown status; `enforceFilesTouched` (post-LLM scope), `enforceSnapshotFlagBan` (post-LLM `-DskipTests`); fix-subagent `fix budget exceeded` refusal at `attempt > max_fix_loops`. **Real TF wiring still mock (`MOCK_TF=1`); Phase 5+ E2E flips.**
- [x] 49. `src/gates/runQuality.ts` — `StackProfile` dispatch (`preflight` / `fast` / `heavy`), log tail (200, edge 3), OOM (edge 19) + `timed_out` flags, exec injection seam. Tests: cmd selection per kind, log truncation, oom/timeout propagation.
- [x] 50. `src/agents/supervisor.ts` — orchestrate subagent → gate → fix-loop. Path overlap refusal (vault §Behavior #1) before any LLM call; O3 supervisor budget cap; `attempt_counter` tracking; cycle guard via `visited_nodes` push + `graph_depth_cap` (edge 32) → `CycleAbortError`. Final-status priority: `budget_exhausted` > `needs_human_clarify` > `done`. `pending_diff_path` written to `runs/<id>/<sup>/pending.diff` only when all tasks green.
- [x] 51. `src/workflows/supervisorBranch.ts` — read `PlannerOutput`, group by supervisor id (`spring`/`react`/`orch`), dispatch `runSupervisor` per group; audit `supervisor_spawn` / `gate_invocation` (per call) / `supervisor_done`. **Phase 5 closeout (task 53):** CLI auto-wires this via `runExecuteLane` + `loadManagedRepos`. `supervisorSpawnGuard` defends raw spawn (refuses unless `cli_flags.execute === true`).
- [x] 52. Scenario A integration test (`tests/workflows/supervisorBranch.test.ts`) — java-spring single-task plan + mock TF (`mockSubagent` / `mockFixSubagent`) + mock gate exec; asserts plan→supervisor→subagent→gate green; `pending.diff` written; audit chain valid; fix-loop converges (gate red → fix → gate green); `max_fix_loops=2` ⇒ aggregate `budget_exhausted` w/ `attempt_counter=3` + 3 `gate_invocation` audit rows; missing `cwds[supervisor]` ⇒ `UnknownSupervisorCwd`.
- [x] 53. **Phase 5 closeout — CLI execute-lane auto-wire.** `src/config/managedRepos.ts` (vault `_meta.md` parser w/ Zod schema + `ORCH_MANAGED_REPOS=<repo-id>:/abs/path,…` env loader + `repoId ↔ supervisorId` map; refusal types `ManagedRepoEnvError` / `ManagedRepoMetaMissing` / `ManagedRepoMetaInvalid`; rethrows `UnknownStackError` from registry). `src/workflows/executeLane.ts` (`runExecuteLane`) composes managed-repo map → `cwds` → `runSupervisorBranch`; `supervisorSpawnGuard` precondition + `MissingManagedRepoError` when plan references unregistered supervisor (boot-time refusal, before any LLM). CLI (`src/cli/orchestrate.ts`) on `execution_started` outcome calls `runExecuteLane`; refuses if `ORCH_MANAGED_REPOS` unset; refuses real-TF mode (subagent TF wiring deferred); `MOCK_TF=1` lane uses `mockSubagent` + `mockFixSubagent` + `mockExec`. Tests: `tests/config/managedRepos.test.ts` (20 — frontmatter parser, env mapping, full pipeline, error rethrow) + `tests/workflows/executeLane.test.ts` (3 — happy w/ audit chain valid; `SupervisorNotWiredError` when no execute flag; `MissingManagedRepoError` when registry empty).

## Phase 6 — second stack + integration (Playbook §Phase 6)

Vault canon: `Build/Playbook.md` §Phase 6; `Build/Prompts/Stacks/ts-react-vite.md`; `Build/Prompts/integration.md`; `Multi-Agent Orchestration PoC#Edge cases` (edge 1 API-first).

- [x] 54. `src/stacks/tsReactVite.ts` — TS + React + Vite stack profile mirror of vault overlay (`installCmd: pnpm install --frozen-lockfile`, `qualityFastCmd: pnpm run check:fast`, `coverageFloor=0.85`, `mutationFloor=0.70`, `snapshotForbiddenFlags=['--update-snapshots','--ci=false']` — bare `-u` intentionally OMITTED to avoid `String.includes('-u')` false positives on `--user`/`--update`; reviewer regex enforcement Phase 7). Registered in `src/stacks/index.ts` registry alongside `java-spring`. Tests: `tests/stacks/tsReactVite.test.ts` (6 — profile shape, codegen guard, registry lookup, snapshot-flag ban list, bare-`-u` omission proof).
- [x] 55. `src/agents/integration.schema.ts` (Zod O1 — `IntegrationOutput {status, rationale, contract_hash, changed_endpoints, ui_drift, recommended_action}`) + `src/agents/integration.ts` (deterministic-only per O2: hash producer's `.json` contract, compare to prior; LLM narrative deferred Phase 7). Refusals: `ContractArtifactMissing` (reader fails) / `ContractFormatUnrecognized` (only `.json` parseable; `.proto`/`.graphql` punt to LLM). Status path: `no_consumer` (no `consumes_contract`) ⇒ proceed; `no_contract` (no `contract_artifact`) ⇒ proceed; hash unchanged ⇒ `compatible` proceed; first publish (`priorContractHash === null`) ⇒ `compatible` proceed; hash differs ⇒ `breaking` block_merge (MVP errs safe; Phase 7 reviewer LLM enriches `ui_drift`). Tests: `tests/agents/integration.test.ts` (9 — all 5 status paths + 2 refusals + canonical-hash whitespace insensitivity + ≤200-char rationale clamp).
- [x] 56. `src/workflows/supervisorBranch.ts` — canonical supervisor order via `compareSupervisorIds` (`spring` → `react` → `orch`, unknowns alpha-sorted last); track `gateContractPublished` locally; after each supervisor done, scan green tasks for `contract_artifact` ⇒ flip published; before each supervisor, if any task `consumes_contract && !gateContractPublished` ⇒ supervisor result `block_for_contract` w/ `next_action: wait_for_contract` (no subagent spawn, no `gate_invocation`); audit emits `supervisor_blocked` event. Aggregate adds `blocked_on_contract`. `SupervisorBranchResult` extended w/ `gate_contract_published` + `contract_producers[]` for downstream integration step. Tests: `tests/workflows/supervisorBranch.test.ts` Phase 6 block (3 — `compareSupervisorIds` ordering inc. unknown ids; React-only consumer w/o producer ⇒ `blocked_on_contract` + zero gate calls + audit `supervisor_blocked`; shuffled plan still runs spring before react + flips gate).
- [x] 57. `src/workflows/integrationStep.ts` (`runIntegrationStep`) — runs after `runSupervisorBranch`; skip reasons audited as `integration_skipped` (`aggregate_not_green` / `no_consumer` / `no_contract_no_consumer` / `not_published`); run path audits `integration_run` w/ `decisions: [status=…, recommended=…, contract=…, producer=…]`. Resolves `contract_artifact` relative to producer cwd. Single shared `AuditWriter` between supervisor branch + integration step (else `prev_hash` forks ⇒ chain break). Tests: `tests/workflows/integrationStep.test.ts` (5 — happy run, breaking on hash drift, all 3 skip reasons; chain valid).
- [x] 58. **Scenario B** (UI-only, `tests/workflows/scenarioB.test.ts`) — react-only plan, no `consumes_contract`, mock TF + mock exec; asserts react supervisor green w/ stack `ts-react-vite`; `gate_contract_published=false`; integration step skipped w/ reason `no_contract_no_consumer`; audit chain valid; `pending.diff` materialized.
- [x] 59. **Scenario C** (cross-repo, `tests/workflows/scenarioC.test.ts`) — spring task w/ `contract_artifact` + react task w/ `consumes_contract`; spring runs first → green → publishes contract; react unblocked → green; integration agent runs against fixture `target/openapi.json` ⇒ `compatible` proceed (both first-publish lane and matching-prior-hash lane); 2 `supervisor_spawn` + 2 `supervisor_done` + 0 `supervisor_blocked` + 1 `integration_run`; chain valid.
- [x] 60. **Phase 6 closeout — `runExecuteLane` + CLI summary.** `runExecuteLane` constructs single `AuditWriter`, threads it through `runSupervisorBranch` + `runIntegrationStep`; result type `RunExecuteLaneResult = SupervisorBranchResult & { integration: IntegrationStepResult }`; `priorContractHash` + `readContract` deps surfaced for tests/Phase 7 reviewer wiring. CLI `BootSummary.execute` extended w/ `integration: { ran, status?, recommended?, reason? }`. Tests: `tests/workflows/executeLane.test.ts` Phase 6 block (2 — Scenario A green w/ `integration_skipped no_contract_no_consumer`; Scenario C lane loads `spring-api` + `react-ui` from `_meta.md` ⇒ `integration_run compatible/proceed` + audit chain valid).

## Phase 8 closeout / Phase 9 — scenarios D + E + O7 trigger evaluation (Playbook §Phase 8 + §Phase 9)

Vault canon: `Build/Playbook.md` §Phase 8 ("Run scenarios A/B/C/D/E end-to-end") + §Phase 9 (½-day decision pass); `Build/Patterns/O7-phase2-numeric-trigger.md`; `Orchestration PoC Demo Scorecard.md` (A–E rows); `Build/Scorecard Generator.md` (`phase_2_eligible` JSON field).

- [x] 61. **Scenario D — test-only change** (`tests/workflows/scenarioD.test.ts`). Single spring supervisor, paths under `src/test/java/**`, no contract; subagent patches test file only; gate green; integration step skipped w/ `no_contract_no_consumer`; audit chain valid; `pending.diff` written. Test writes a `scenario_tag` audit event (`decisions: ["scenario=D"]`) so the scorecard classifier can disambiguate D from A — the two scenarios share an audit shape (single spring supervisor, no contract) and require the explicit tag override.
- [x] 62. **Scenario E — refactor no-op (O5 skip)** (`tests/workflows/scenarioE.test.ts`). All-checked tasks fixture + clean git status + no prior fix-loop ⇒ `plannerDryRun()` returns `skip:true`; `runPlannerBranch` audits `planner_skipped` + returns outcome `skipped`. Asserts: planner LLM completion never invoked; zero `planner_emitted` / `dry_plan` / `execution_started` / `supervisor_spawn` events; chain valid. Scorecard heuristic: any `planner_skipped` step ⇒ scenario `E`.
- [x] 63. **Scorecard scenario classifier + O7 numeric trigger** (`src/scorecard/aggregate.ts`). New: `inferScenario(acc)` (explicit `scenario=X` decision-token override; else heuristic — `planner_skipped` ⇒ E; ≥2 `supervisor_spawn` + `integration_run` ⇒ C; single react ⇒ B; single spring ⇒ A; else `unknown`). `inferGreen(acc, chainValid)` (chain valid AND no `supervisor_blocked` AND all `supervisor_done` outcomes `status=done`). `inferFixLoops(acc)` (`gate_invocation_count - supervisor_done_count`, clamped at 0). `TotalsRollup` extended w/ `green_count`, `green_pct`, `avg_fix_loops`, `scenarios_seen`, `phase_2_eligible` (`green_pct >= 80 AND avg_fix_loops <= 1.5 AND chain_breaks === 0` over scanned runs). `format.ts` adds an "O7 Phase-2 trigger" block + per-run `scenario` / `green` / `fix_loops` cells. Tests: `tests/scorecard/aggregate.test.ts` Phase 9 block (6 — E from planner_skipped, A↔D tag override, B from react, C from cross-repo + integration, fix_loops counter + supervisor_blocked greenness, `phase_2_eligible` flips on each O7 bar including empty-runs guard).
- [x] 64. **Phase 9 decision note** — `docs/decisions/2026-05-04-0001-phase-2-trigger-evaluation.md`. PoC mock surface meets O7 bars (`green_pct=100`, `avg_fix_loops=0`, `chain_breaks=0` on synthetic fixtures); real-TF graduation requires ≥ 5 consecutive runs against managed repos; Phase 2 work blocked until that re-run flips ADR status. `_index.md` updated to list ADR 0001.

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

- [x] 31. `src/policy/hitl.ts` — signal mapping + audit `hitl_escalation`. **Phase 7 (approval).**
- [x] 32. `--danger-apply` requires `--reason`. **Phase 7.**

### SF6 — telemetry + abuse

- [x] 33. Audit rollup / `pnpm run scorecard` counters. **Phase 8.**
- [x] 34. Abuse vitest: supervisor spawn throws if `!cli_flags.execute`. _Landed `supervisorSpawnGuard()` in `src/workflows/plannerBranch.ts`; throws `SupervisorNotWiredError` unless `cli_flags.execute === true` (`undefined`, `false`, truthy strings all refused); test cases cover 4 negative + 1 positive._

## Inngest integration (durable outer DAG — self-hosted only)

Vault chunk + HITL + license/outbound posture: `Orchestration PoC/Inngest Integration Plan.md`. Tick **I1…I6** there between PR groups. **Mastra stays inside** `step.run`. **Inngest Cloud rejected**. Mastra suspend/resume **dropped** (Inngest `waitForEvent` owns HITL).

Per Playbook Phase 5: "**Inngest (optional):** if org uses Inngest+Mastra, land **I1–I3** before Scenario A E2E." Decision deferred until Phase 5 entry.

### I1 — ADR

- [x] 35. Mirror vault Examples ADR 0003 → `docs/decisions/2026-MM-DD-0003-inngest-outer-durable-shell.md`. _Landed in vault Examples 2026-05-03; orchestrator mirror at Phase 5 entry._ **Landed 2026-05-04 commit `7ee1563` as orchestrator-local id ADR 0002 (`docs/decisions/2026-05-04-0002-inngest-outer-durable-shell.md`); vault ADR id 0003 → orchestrator id 0002 — orchestrator ADR sequence local to repo. Status `accepted` (laptop PoC GREEN); prod-promotion caveat = source-grep + tcpdump re-run on prod-binary sha (Appendix A)).**

### I2 — Dev deps + serve + outbound verification (gate)

- [ ] 36. Add `inngest` pkg + `src/inngest/{client,serve}.ts`. _Vault RepoKit starters landed 2026-05-03; orchestrator copy at Phase 5 entry._
- [ ] 37. `.env.example` + `BootConfig` Inngest vars + README run-dev section. _Vault RepoKit starters landed 2026-05-03._
- [x] 37a. **Outbound verification gate** — DoD checklist (source grep + tcpdump 3 windows + telemetry-disable env vars + ADR appendix). _Vault verdict GREEN-caveated 2026-05-03 against server commit `acbefdc7`; tcpdump deferred to pre-prod. Re-run on prod binary before ADR 0005 promotion._ **Laptop PoC fully GREEN 2026-05-04 commit `7ee1563`: source-grep half via `scripts/verify-inngest-outbound.sh` (vault evidence vs `acbefdc7`); tcpdump 3-window manual half ran 2026-05-05 vs installed `inngest` v1.19.1 build `dfcc1f544` — zero outbound across boot-idle / steady-idle / job-run windows (full evidence + caveats in ADR 0002 Appendix A). Sha-alignment + execution-path caveats propagate to I3+ PRs; prod-binary re-run still owed before flipping ADR 0005 → `accepted`.**

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

## Phase 10 — verification close (Playbook §Verification)

Vault canon: spec `tasks.md` §Verification (this file). Phase 10 covers tasks 13/14/16. Stryker (15) landed Phase 11 — Stryker 9.6.1 + vitest-runner + typescript-checker, scoped to `src/audit/**`, `mutation_score=90.36%` ≥ 80% break threshold. Reviewer/human approval (17) is HITL-gated, lands at PR cut.

- [x] 13. `pnpm run quality` green (tsc + ESLint `--max-warnings=0` + Vitest). _Phase 10: ESLint flat config (`eslint.config.js`) — `@eslint/js` recommended + `typescript-eslint` recommended, `no-unused-vars` w/ `^_` argsIgnorePattern, `no-useless-assignment` off (overzealous on init-then-loop-reassign), `no-control-regex` disabled inline at NUL sentinel in `src/gates/caveman.ts`. `pnpm run quality` = `typecheck && lint && test:run`. 9 baseline ESLint errors fixed (3 autofixed regex-spaces + 6 dead helpers / regex/sentinel). 253 tests still green, 0 lint warnings._
- [x] 14. Coverage threshold met: `src/audit/**` ≥ 90%; rest ≥ 70%. _Phase 10: `@vitest/coverage-v8@^2.1.8` (matched to `vitest@^2.1.8` peer); `vitest.config.ts` w/ `provider: v8` + per-glob threshold (`src/audit/**`: 90 lines/stmts/fns/branches; root: 70). CLI/script entrypoints excluded (`src/cli/**`, `src/inngest/**`, `src/audit/verify.ts`, `src/scorecard/{index,format}.ts`, `src/reviewer/index.ts`, `src/runs/loadSpec.ts`, `src/approval/index.ts`, `src/stacks/types.ts`). Result: `All files 92.53% / 84.06% / 94.07% / 92.53%`; `src/audit/**` 99.30% lines (jsonl.ts only)._
- [x] 15. Stryker scoped to `src/audit/**` ≥ 80% mutation. _Phase 11: `@stryker-mutator/{core,vitest-runner,typescript-checker}@9.6.1` (devDep). `stryker.conf.json` mutates `src/audit/**/*.ts` excluding `verify.ts` (CLI entrypoint), runner=vitest, checker=typescript, `coverageAnalysis: perTest`, `thresholds: { high: 90, low: 80, break: 80 }`, reports → `reports/mutation/{mutation.html,mutation.json}` (gitignored alongside `.stryker-tmp/`). Initial run scored 78.31% (65/83 killed); added 9 targeted kill tests in `tests/audit/redaction.test.ts` (Bearer `\s+` quantifier · empty-literal skip in `redactString`/`findLeak` · default-empty literals/secrets params · `findLeak` 4-char truncation · `RedactionFailure` message shape · `ZERO_HASH` 64-zero width · flag-file `\n` terminator · `RedactionFailure` thrown w/ message regex). Final score 90.36% (75/83 killed, 8 survived — all in untestable `Object.values`/`Array.isArray` symmetry zones in `redactValue`/`scanLeak` traversal where the array branch is structurally redundant w/ the object branch). `pnpm run mutation` = `stryker run`._
- [x] 16. Egress allowlist test: only TF base URL hit during full test run. _Phase 10: `tests/setup/egressGuard.ts` setupFile monkey-patches `globalThis.fetch` to reject every call (TF egress goes through `TfClient.fetchImpl` injection seam in tests; nothing should hit the real network). `tests/setup/egressGuard.test.ts` (2) asserts string + URL inputs both reject. Override `ALLOW_TEST_EGRESS=1` reserved for future real-TF live-probe smoke._
- [x] 17. Reviewer agent / human approves diff (per-supervisor approval). _Human approved via PR #1 merge 2026-05-04 (merge commit `e2036e0`). Per-supervisor reviewer agent (Phase 7) covers programmatic surface; PR merge = human override at C1–C5._

## Wrap

- [x] 18. Update `_active.md` — move spec to `done`. _PR-cut wrap 2026-05-04: spec moved out of "Active specs" into new "Done specs" section pointing at PR link (set after `gh pr create`)._
- [x] 19. Update `_index.md` — set `Merged: <date>`. _Set 2026-05-04 (merge commit `e2036e0`); status flipped `active → merged` in same commit._
- [x] 20. File ADR if anything architectural surfaced. _N/A — only ADR emitted across phases 1–11 was 0001 (Phase 9 closeout, Phase-2 trigger evaluation). No further architectural surface in Phase 10 (verification close) or Phase 11 (Stryker scope). Vault Examples ADRs 0003/0004/0005 mirror at Inngest entry, not bootstrap close._

## Blockers

| Task # | Blocked by | Owner | Note |
| ------ | ---------- | ----- | ---- |
| 6 (probe path final-confirm) | TF capability probe response shape | Preston | `/v1/models` chosen as PoC probe; re-confirm vs TF endpoint docs once landed |
| 7 | hash algorithm choice (SHA-256 vs Blake3) | Preston | leaning SHA-256 (stdlib) |
| 21–34 (self-fidelity) | Vault **SF\*** HITL ticks | Preston | `Orchestrator Self-Fidelity Parity.md` |
| 35–46 (Inngest) | Vault **I\*** HITL ticks; **37a outbound gate** blocks I3 merge | Preston | optional per Playbook Phase 5 |
