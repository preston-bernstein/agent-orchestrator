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
- [~] 5. Add `.env.example` + `src/config/env.ts` w/ Zod-validated `BootConfig`. Tests: missing `TF_BASE_URL` fails boot; full env passes. _Partial: env loader landed; TF_BASE_URL refusal lands Phase 3._
- [ ] 6. Add `src/tf/client.ts` w/ `fetch`-based wrapper + capability probe. Tests: hostname check, mocked OK + 5xx + auth-error paths. **Phase 3.**
- [x] 7. Add `src/audit/jsonl.ts` w/ chained writer (canonical JSON + SHA-256 prev_hash). Tests: chain verify, key-order independence, secret-redaction guard. **Phase 2.**
- [x] 8. Add `src/audit/verify.ts` CLI: `pnpm run audit:verify <path>` returns ok / break-at-record-N. **Phase 2.**
- [x] 9. Add `src/runs/state.ts` w/ atomic tmp→rename writer (edge 44). **Phase 2.**
- [ ] 10. Add `src/cli/orchestrate.ts` (Mastra workflow CLI entry). _Stub landed in commit 1507957 — Mastra wiring + TF probe lands Phase 3+._
- [ ] 11. Add `specs/no-op.md` so `pnpm run orchestrate -- --spec specs/no-op.md` has something to read. **Phase 4 (planner).**
- [~] 12. Add `README.md` boot section. _Stub landed; full PLAYBOOK_EXPECTS yaml block lands Phase 0 close._

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

- [ ] 25. Implement `plannerDryRun()` per vault `Build/Patterns/O5-planner-dry-run.md`. **Phase 4.**
- [ ] 26. Insert pre-planner workflow step. **Phase 4.**

### SF3 — A4 `--dry-plan` / `--execute`

- [ ] 27. CLI flags `--dry-plan` + `--execute`. **Phase 4.**
- [ ] 28. Persist `runs/<run_id>/plan.json`; dry-plan stops before supervisors. **Phase 4.**
- [ ] 29. Integration test: `--dry-plan` ⇒ zero managed-repo subprocess. **Phase 4.**

### SF4 — assembler allow-list (MVP)

- [ ] 30. `src/llm/assemblePrompt.ts` — reject if globs ∉ `path_ownership_map`. **Phase 4.**

### SF5 — HITL policy hook (**C1–C5**)

- [ ] 31. `src/policy/hitl.ts` — signal mapping + audit `hitl_escalation`. **Phase 7 (approval).**
- [ ] 32. `--danger-apply` requires `--reason`. **Phase 7.**

### SF6 — telemetry + abuse

- [ ] 33. Audit rollup / `pnpm run scorecard` counters. **Phase 8.**
- [ ] 34. Abuse vitest: supervisor spawn throws if `!cli_flags.execute`. **Phase 4 / 5.**

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
| 6 | TF capability probe response shape | Preston | open question in `requirements.md` |
| 7 | hash algorithm choice (SHA-256 vs Blake3) | Preston | leaning SHA-256 (stdlib) |
| 21–34 (self-fidelity) | Vault **SF\*** HITL ticks | Preston | `Orchestrator Self-Fidelity Parity.md` |
| 35–46 (Inngest) | Vault **I\*** HITL ticks; **37a outbound gate** blocks I3 merge | Preston | optional per Playbook Phase 5 |
