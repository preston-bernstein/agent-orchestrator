---
adr: 0004
created: 2026-05-05
updated: 2026-05-05
status: proposed
supersedes:
superseded_by:
tags: [decision, adr, inngest, self-hosted, prod, deferred]
---

# ADR 0004: Inngest self-host prod target — own Postgres + Redis on internal LAN (deferred)

> **Provenance.** Mirrored from vault `Examples/docs/decisions/2026-05-03-0005-inngest-self-host-prod-target.md` (vault ADR id 0005 → orchestrator id 0004 — orchestrator ADR sequence is local to this repo). Decision rationale is canonical in vault; this file is the orchestrator-local authoritative copy. Vault wikilinks rewritten to local cross-refs (vault ADR 0003 → orchestrator [ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md); vault ADR 0004 → orchestrator [ADR 0003](2026-05-05-0003-observability-split.md)).

## Status

`proposed` — **deferred** until **I3 + I5 ticked end-to-end on laptop** (per vault `Inngest Integration Plan.md` §I6). Promote to `accepted` only after laptop PoC graduates: Phase 5 Scenario A E2E + 37a outbound-verify DoD green ([ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md) Appendix A) + observability split exercised on real runs ([ADR 0003](2026-05-05-0003-observability-split.md)).

This ADR is a **sketch** — captures the prod target shape so when laptop PoC is ready to graduate, the build-out is mechanical, not architectural.

## Context

Laptop PoC ships w/ Inngest dev defaults: SQLite + in-mem Redis, single-process, ephemeral. Fine for one operator on one machine; not durable across reboots, no fan-out, no concurrent operators.

Prod target = single internal LAN host (or small cluster) running:
- Inngest server binary (`inngest start`).
- Own Postgres (durable event log + step memoization).
- Own Redis (queue / lease coordination).
- Same internal-only constraint as ADR 0002 — no Cloud, ever.

[ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md) commits to self-host-only. This ADR specifies *what* self-host means at prod scale.

## Decision (sketch)

**Topology:**
- One Inngest server host on internal LAN (start: a single Linux box; scale-out later if needed).
- Postgres + Redis co-located OR on existing internal infra (re-use what's already running rather than provisioning new).
- Orchestrator process (this repo) on its own host; reaches Inngest server over LAN.

**Process invocation:**
```bash
INNGEST_POSTGRES_URI="postgres://inngest:<secret>@db.lan.local:5432/inngest" \
INNGEST_REDIS_URI="redis://redis.lan.local:6379/0" \
INNGEST_SIGNING_KEY="$(secret-store get inngest/signing-key)" \
INNGEST_EVENT_KEY="$(secret-store get inngest/event-key)" \
inngest start
```

(Exact env names TBD against Inngest server binary at promotion time; verify against [self-host docs](https://www.inngest.com/docs/self-hosting) when this ADR graduates.)

**Secrets:**
- `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` rotated via internal secret store (whatever org standard is — Vault, AWS SSM, 1Password, etc.). **Never in git.** Never in `.env` files committed to the repo.
- Postgres + Redis credentials via the same secret store.
- Local laptop `.env` files (gitignored) are dev-only; prod hosts pull from secret store at start.

**Network posture:**
- Inngest server bound to internal LAN interface only (not `0.0.0.0`); confirmed by `ss -ltn` post-boot.
- Egress firewall continues to enforce internal-only (no `*.inngest.com` outbound, no SaaS telemetry — same posture verified in 37a on dev server).
- Re-run 37a outbound-verify on the prod binary commit sha at promotion time. **Includes tcpdump captures (3 windows) + sha-aligned source-grep + full-execution-path job-run window** (per ADR 0002 Appendix A — laptop PoC was unblocked on source-grep at `acbefdc7` + tcpdump at `dfcc1f544` + ingest-only execution path; sha-alignment + execution-path caveats remain). Captures: 5-min boot-idle + 5-min steady-idle + 5-min job-run; destinations expected = `127.0.0.1` / LAN Postgres+Redis only.

**Storage:**
- Postgres durability per existing internal Postgres SLA (backup cadence, replication if available). Inngest event log persists across reboots — this is the durability win.
- Redis = queue / coordination only; ephemeral acceptable. Loss of Redis = transient retries, not data loss.
- `runs/<runId>/audit.jsonl` chain stays per-orchestrator-host (single writer per ADR 0003); chain survives Inngest pruning. Back up `runs/` per host.

**Observability:**
- Inngest UI exposed on internal LAN (auth via reverse proxy or Inngest's own auth — TBD at promotion).
- `audit.jsonl` verifier CLI runs against orchestrator host's `runs/` (unchanged from laptop).
- Both sinks per ADR 0003; prod doesn't change the split.

**Cloud rejected (re-affirmed).** Same hard constraint as ADR 0002.

## Consequences

**Positive:**
- Durable across orchestrator + Inngest server reboots. Crash-resume = re-emit event (already true on laptop; prod adds Postgres survival).
- Multiple operators can share one Inngest server (long-running PoC scaling path).
- Cron / scheduled triggers (Phase 2 nightly Stryker) become real, not laptop-dependent.

**Negative:**
- Operational surface: one more service to run + monitor (Inngest server). Postgres + Redis are likely existing infra.
- Promotion requires re-running outbound-verify against the prod binary commit sha. Don't ship without it.
- Secret-store integration adds setup cost first time.

**Neutral / accepted:**
- Single-host start = single point of failure. Accepted at PoC-graduation scale; revisit if SLA needs grow.
- License (SSPL on server) unchanged from ADR 0002. Internal use ≠ SSPL trigger.

## Alternatives considered

| Option                                                                     | Why rejected (or deferred)                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Inngest Cloud                                                              | Hard org constraint; reaffirmed from ADR 0002. Non-starter.                                           |
| Stay on laptop SQLite + in-mem Redis forever                               | No multi-operator path; no reboot durability. PoC-only.                                               |
| SQLite-only single-node prod (no Postgres + Redis)                         | Simpler ops, but loses concurrent-operator + scale-out path. Revisit if ops cost of Postgres dominates. |
| Containerize Inngest server (Docker / Podman on internal host)             | Compatible w/ this ADR — choice of packaging is downstream. Defer; pick at promotion.                 |
| Run Inngest server on each orchestrator host (no shared server)            | Loses event-fan-out across operators; back to single-machine model. Defeats the point.                |

## Affected specs / areas (at promotion time)

- New host(s) on internal LAN: Inngest server + Postgres (or extension to existing) + Redis (or existing).
- Secret store entries: `inngest/signing-key`, `inngest/event-key`, Postgres + Redis creds.
- `.env.example` — document prod env vars (URIs, secret-store fetch pattern); laptop defaults stay.
- `README.md` — extend §Inngest w/ self-host prod section pointing here at promotion (today: brief deferred-to-ADR-0004 pointer).
- Egress firewall rule review: Inngest server box → only LAN Postgres+Redis; orchestrator → Inngest server LAN only.
- 37a outbound-verify re-run on prod binary commit sha (sha-aligned source-grep + tcpdump 3-window + full-execution-path job-run, per ADR 0002 Appendix A caveats).
- ADR 0004 status `proposed` → `accepted` once promoted.

## Revisit when

- I3 + I5 confirmed end-to-end on laptop (PoC → prod-ready trigger).
- Multi-operator / reboot-durability becomes a concrete need (one operator wants to share, or laptop reboots lose runs).
- Self-host operational cost (Postgres + Redis) outweighs hand-roll in prod ⇒ revisit SQLite-only path.
- Inngest server licensing posture changes (e.g. AGPL relicense of server) — re-check ADR 0002 SSPL stance carries.
- Org provisions a different durability backing (e.g. Temporal cluster lands internally) — could supersede this whole stack.
- 37a outbound-verify on prod binary finds non-disable-able phone-home → kill switch ADR 0002 + 0004.

## Related

- [ADR 0002](2026-05-04-0002-inngest-outer-durable-shell.md) — outer durable shell; commits to self-host-only (this ADR specifies *what* self-host = at prod).
- [ADR 0003](2026-05-05-0003-observability-split.md) — observability split; unchanged at prod (chain stays per-host).
- Vault `Orchestration PoC/Inngest Integration Plan.md` §I6.
- [Inngest self-host docs](https://www.inngest.com/docs/self-hosting) — authoritative for env names + flags at promotion time.
