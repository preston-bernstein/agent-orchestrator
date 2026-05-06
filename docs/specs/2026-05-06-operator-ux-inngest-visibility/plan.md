# Operator UX — Inngest steps, gates-only trigger, artifact links

Goal: single mental model (**event → durable steps → audit**) with readable Inngest timeline + optional **gates-only** run without planner/execute.

## Phase 1 — Documentation (implementer + operator)

- [x] This plan file.
- [x] **[`step-names.md`](./step-names.md)** — canonical `step.run` ids for `orch-run`.
- [x] README operator bullets (`--gates-verify`, artifact URLs).

## Phase 2 — Inngest visibility (execute lane gates)

- [x] **`wrapGateRun`**: optional on `RunSupervisorDeps`; `taskLoopHelpers` wraps each `runQuality` in `gate:<taskId>:<kind>:a<attempt>` when provided.
- [x] `runExecutePath` wires `wrapGateRun` → `step.run(...)`.
- [x] Thread through `SupervisorBranchDeps` → `RunExecuteLaneDeps`.

## Phase 3 — `orch/gates.verify.requested`

- [x] Event schema (+ Zod in `src/inngest/client.ts`): same core fields as dry-plan + optional `gateKinds: ("preflight"|"fast"|"heavy")[]` default `["preflight","fast"]`.
- [x] `runOrchPrePlannerSteps` extracted from bootstrap (expectations + tf-probe).
- [x] `orchGatesVerifyHandler`: pre-planner → `load-managed-repos` → for each managed repo (order `spring`→`react`→orch) × each gate kind, `step.run("gate-verify:<sup>:<kind>", …)` + `AuditWriter` `gate_invocation` rows.
- [x] `orch-run` registers third trigger + handler dispatches by `event.name`.
- [x] `OrchRunResult` extended with `{ status: "gates_verify_done"; failures: { supervisorId; kind; exit }[] }`.

## Phase 4 — Planner caveman audit visibility

- [x] Optional `onCavemanCompress` hook on `runPlanner` input → `plannerBranch` writes `step: caveman_compress` audit lines (`header`, per spec slug).

## Phase 5 — CLI + summary JSON

- [x] `parseArgs`: `--gates-verify` (mutex w/ `--execute` / `--dry-plan`).
- [x] `sendOrchestrateEvent` sends `orch/gates.verify.requested`.
- [x] `BootSummary`: `artifact_base_url`, `audit_url`, `runs_dir_relative`; outcome `gates_verify` when applicable.
- [x] Optional env `ORCH_ARTIFACT_BASE_URL` in `loadBootConfig` (default derive `http://127.0.0.1:${PORT||3030}` in CLI when unset).

## Phase 6 — Tests

- [x] Update `tests/inngest/client.test.ts` (event count + schema smoke).
- [x] `tests/integration/inngest-orch-run.test.ts`: gates-verify path asserts step ids order + empty managed repos error or inject repos.

## Out of scope (later)

- Split Mastra subgraph into separate `step.run` spans.
- Caveman audit inside **subagent** / **fix** paths (reuse same hook pattern).
- `Send test event` JSON templates committed under `fixtures/inngest/`.
