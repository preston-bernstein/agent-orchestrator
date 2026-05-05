---
adr: 0003
created: 2026-05-05
updated: 2026-05-05
status: accepted
supersedes:
superseded_by:
tags: [decision, adr, observability, audit, inngest, hash-chain]
---

# ADR 0003: Observability split — Inngest UI + `audit.jsonl` hash chain (both sinks kept)

> **Provenance.** Mirrored from vault `Examples/docs/decisions/2026-05-03-0004-observability-split.md` (vault ADR id 0004 → orchestrator id 0003 — orchestrator ADR sequence is local to this repo). Decision rationale is canonical in vault; this file is the orchestrator-local authoritative copy. Vault wikilinks rewritten to local cross-refs (vault ADR 0003 → orchestrator [ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md)).

## Status

`accepted`

## Context

Inngest landed as outer durable shell ([ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md)). Inngest UI ships a step graph + history + replay UI for free — tempting to drop the hand-rolled `audit.jsonl` hash chain "to save work." This ADR locks the split so future contributors don't gut the chain.

Two sinks exist for **different reasons**, not redundancy:

- **Inngest UI / history** — *ops trace*. Step graph, durations, retries, fan-out shape, payload snapshots, replay-by-event. Purpose-built for "what happened in this run." Storage owned by Inngest server (Postgres + Redis); pruned per server config.
- **`audit.jsonl` hash chain** — *tamper-evident security proof*. Canonical-JSON + SHA-256 prev-hash chain (G5). Per-run file `runs/<runId>/audit.jsonl`. Verifier CLI (`pnpm run audit:verify`) returns ok / break-at-record-N. Survives Inngest history pruning.

The two answer different questions:

| Question                                                                | Sink                |
| ----------------------------------------------------------------------- | ------------------- |
| "Which step retried? How long did `mastra-plan` take? Show me the DAG." | Inngest UI          |
| "Was the audit chain tampered with? Did anyone replay an old approval?" | `audit.jsonl` chain |
| "Replay this run from the same event."                                  | Inngest UI          |
| "Prove this approval / diff hash binding to a third party."             | `audit.jsonl` chain |

Inngest history is **opaque ops trace**, not security guarantee — payloads stored, but not in a tamper-evident chain. Hash chain is the security proof.

## Decision

**Both sinks. Locked.** Do not collapse one into the other.

**Single-writer invariant for `audit.jsonl`:** writes happen **only** inside `step.run('audit-<name>', () => audit(ctx, decision, extra))`. One writer per run, idempotent by `(runId, stepName)`. Step retries replay the audit body; canonical-JSON serialization makes the hash deterministic; INSERT semantics duplicate-tolerant via `decision`-+-`prev_hash` lookup before append (real impl, task 7).

**Verifier CLI unchanged:** `pnpm run audit:verify runs/<runId>/audit.jsonl` returns 0 = chain valid; non-zero = break-at-record-N. Tested independent of Inngest (no Inngest mock needed in audit unit tests).

**Inngest history is consulted for ops, not policy.** Compliance / approval-binding evidence comes from the chain. CI / scorecard counters (`hitl_count`, `o5_skip_count`, etc.) read the chain, not Inngest history.

**README contract:** table contrasting the two sinks present in `README.md` §Inngest. Drift between this ADR + the README = doc bug, fix the README.

## Consequences

**Positive:**
- Future contributor reading ADR 0003 understands *why* both exist — guards against "let's just use Inngest UI" PRs.
- Hash chain survives Inngest server prune / reset / re-host. Audit evidence portable.
- Inngest UI stays free-of-policy — we don't bend it to be a security artifact (which it isn't).
- Verifier CLI keeps a clean dependency boundary (no Inngest dep in `src/audit/`).

**Negative:**
- Two sinks = two things to read on incidents. Mitigated by clear table-of-questions above.
- Storage cost: `audit.jsonl` per-run grows linearly w/ steps. Cheap (KB-scale per run); no rotation needed at PoC scale.
- Single-writer invariant requires discipline — any code that writes to `audit.jsonl` outside `step.run('audit-*', ...)` breaks the chain. Lint rule (future, edge 41) can ban direct writes.

**Neutral / accepted:**
- Inngest payload-redaction settings still apply (secrets must not appear in event payloads). Orthogonal to this ADR — covered by edge 9 secret-redaction filter.
- Replay-by-event (re-emit same `runId`) replays audit writes inside step retries; idempotent so chain doesn't double-grow.

## Alternatives considered

| Option                                                                     | Why rejected                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Drop `audit.jsonl`; rely on Inngest history                                | Inngest history opaque + prune-able; not tamper-evident. Loses security guarantee. Headline anti-pattern this ADR exists to block. |
| Drop Inngest UI; rely on `audit.jsonl` only                                | Loses ops-trace ergonomics (step graph, durations, replay UI). Pays Inngest cost without using its UI. |
| Mirror full Inngest history into `audit.jsonl`                             | Doubles write volume; no security gain (mirrored bytes still need a chain to be tamper-evident).   |
| Move chain into Postgres (alongside Inngest data)                          | Couples audit storage lifecycle to Inngest server. Defeats "survives Inngest prune" property.      |
| Separate verifier service over Inngest history                             | Re-implements hash chain on top of opaque storage. Strictly worse than direct JSONL chain.         |
| Skip ADR; let README carry the policy                                      | README is mutable docs; an ADR is a decision record. Explicit `accepted` ADR survives doc rewrites. |

## Affected specs / areas

- `src/audit/jsonl.ts` (task 7) — single-writer; canonical-JSON; SHA-256 prev-hash. No change vs original spec; this ADR ratifies it.
- `src/audit/verify.ts` (task 8) — CLI unchanged. No Inngest dep.
- `src/inngest/functions/orch-run.ts` (task 38; I3, gated) — all audit writes inside `step.run('audit-*', ...)` (already specified in vault `inngest-orch-run.ts.starter`).
- `README.md` §Observability split — table contrasting sinks (lands at I3 README pass; this ADR locks intent ahead of code).
- `src/scorecard/` — counters read `audit.jsonl`, not Inngest history.
- Future lint rule (edge 41) — ban direct file writes to `runs/<runId>/audit.jsonl` outside `step.run('audit-*', ...)`.

## Revisit when

- Inngest ships a tamper-evident history primitive (signed event log w/ hash chain) → could collapse sinks. Today: not on Inngest roadmap.
- Audit storage cost becomes meaningful (multi-MB per run) → revisit storage backend, NOT the chain itself.
- Compliance regime mandates a third sink (e.g. external SIEM) → add as extra writer, do not remove the chain.
- A future ADR replaces hash algorithm (SHA-256 → Blake3 etc.) — open question per `requirements.md`. This ADR's structure stays; only algorithm changes.

## Related

- [ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md) — outer durable shell; this ADR elaborates the §Observability decision in 0002.
- Vault `Orchestration PoC/Inngest Integration Plan.md` §I5.
- Vault `Multi-Agent Orchestration PoC.md` G5 (audit chain) + G7 (HITL boundary).
