---
spec: 2026-05-04-orchestrator-bootstrap
created: 2026-05-04
updated: 2026-05-04
status: active
repo: agent-orchestrator
stack: ts-node
pair_slug:
tags: [spec, requirements]
---

# Requirements — Orchestrator bootstrap

## Context

Stand up the Mastra-based orchestrator project on locked work laptop. Prove TrustFoundry call works, prove audit JSONL writer captures every step, prove `pnpm run orchestrate` reaches a green pipeline on a no-op spec. Foundation for all later supervisor / subagent work.

Mirrors vault `Examples/docs/specs/2026-05-02-orchestrator-bootstrap/` — slug + dates updated to today's repo seed.

## EARS

- WHEN developer runs `pnpm install`, SYSTEM SHALL install pinned `@mastra/*` deps without errors.
- WHEN developer runs `pnpm run orchestrate -- --spec <path>`, SYSTEM SHALL execute the workflow CLI and exit 0 on a no-op spec.
- WHEN orchestrator boots, SYSTEM SHALL load TF base URL + key from env (`TF_BASE_URL`, `TF_API_KEY`) and refuse to start if either missing.
- WHEN orchestrator makes any model call, SYSTEM SHALL route through TF base URL only — no other host in egress.
- WHEN any workflow step completes, SYSTEM SHALL append a JSONL record to `runs/<run-id>/audit.jsonl` w/ fields `run_id, step, agent, cmd, cwd, exit, tokens_in, tokens_out, model, prev_hash, timestamp`.
- WHEN audit record is written, SYSTEM SHALL compute hash chained on prior record (`prev_hash` field).
- WHEN run completes, SYSTEM SHALL exit 0 on success, non-zero on first hard failure, w/ a one-line caveman summary on stdout.
- IF `TF_API_KEY` appears in any audit log line, THEN SYSTEM SHALL fail the run + write `redaction_failure.flag`.

## Out of scope

- Supervisors / subagents (separate spec).
- Reviewer LLM step (separate spec).
- Human approval node (separate spec).
- Mastra Studio integration (Phase 2).

## Open questions

- Pin Mastra version: latest stable vs locked minor? — owner: Preston — needed by: Phase 1 close.
- Audit chain: SHA-256 hex or Blake3? — owner: Preston — leaning SHA-256 (stdlib, no extra dep).

## Acceptance

- [ ] All EARS rows have a passing test (`vitest`).
- [ ] `pnpm run orchestrate -- --spec fixtures/no-op.md` exits 0.
- [ ] `pnpm run audit:verify runs/<id>/audit.jsonl` returns "chain valid."
- [ ] Egress allowlist test passes: only TF base URL hit.
- [ ] README boot section + `.env.example` shipped.
