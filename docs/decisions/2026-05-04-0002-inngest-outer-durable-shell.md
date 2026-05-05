---
adr: 0002
created: 2026-05-04
updated: 2026-05-04
status: accepted
supersedes:
superseded_by:
tags: [decision, adr, inngest, mastra, durability, hitl, self-hosted]
---

# ADR 0002: Inngest = outer durable shell, Mastra = inner pure-fn

> **Provenance.** Mirrored from vault `Examples/docs/decisions/2026-05-03-0003-inngest-outer-durable-shell.md` (vault ADR id 0003 → orchestrator id 0002 — orchestrator ADR sequence is local to this repo). Decision rationale is canonical in vault; this file is the orchestrator-local authoritative copy w/ Appendix A scoped to **this repo's** outbound-verification evidence.

## Status

`accepted` (laptop PoC). **Caveated** for prod promotion until 37a manual half (tcpdump 3 windows) re-runs against the prod Inngest binary commit sha — see Appendix A.

## Context

PoC needs durable steps, retries, fan-out, HITL pause, idempotency across crashes / laptop sleep. Hand-roll today (in this orchestrator): atomic state JSON (edge 44), `--resume` flag (edge 11), TF exp backoff (edge 28), per-repo lockfile (edge 40), `p-limit` concurrency cap, file-touch poll for approval (G4). Mastra ships `Workflow` + `Agent` + (TBD) `suspend/resume`; doesn't own retries / events / idempotency.

Hard org constraint: **no SaaS, no outbound calls, internal-only.** Rules out Inngest Cloud. Self-host = OSS, SSPL on server (delayed Apache 2.0 3y); SSPL only triggers on resell-as-a-service to outsiders → internal use **not** triggered.

Two scheduler primitives in same plan = footgun. Mastra `suspend()` mid-step would block Inngest step executor → bounded-step contract broken. Pick one HITL primitive.

## Decision

**Outer:** self-hosted Inngest fn `orch-run` listening on distinct events:
- `orch/dry-plan.requested`
- `orch/run.requested`
- `orch/approve.<supervisor>` (one per supervisor: `spring`, `react`, …)
- `orch/cancel.requested`

**Inner:** Mastra `Workflow` + `Agent` invoked from `step.run('mastra-<phase>')`. Mastra Workflow = pure `(input, ctx) → result | { pending: checkpoint }`. **No** Mastra suspend/resume. **No** nested Inngest from inside Mastra subgraph (would nest schedulers).

**HITL:** Inngest `step.waitForEvent('orch/approve.<sup>', { match: 'data.runId', timeout: '7d' })` between `mastra-<sup>-pre-approval` and `mastra-<sup>-resume` steps. Diff artifact written before wait. Per-supervisor (G4 boundary preserved).

**TF idempotency:** at fetch wrapper. Cache `(runId, agentName, promptHash) → response` (laptop SQLite / prod Postgres). Whole Mastra Agent invocation = one Inngest step; step retry replays Agent for free via cache hit.

**Observability: both sinks kept.**
- Inngest UI = ops trace (durable, opaque, replayable).
- `audit.jsonl` hash chain = tamper-evident security proof (single writer inside `step.run`).
- Inngest history does **not** replace JSONL (opaque ≠ proof).

**Cloud rejected.** Hard constraint. Self-host only, on internal LAN, w/ own Postgres + Redis prod (SQLite + in-mem Redis laptop).

**Pre-merge gate (37a):** outbound-verify DoD checklist binds I3 merge — see Appendix A. Asymmetric cost: false-pass = rip-out post-Phase 5 (huge); false-fail = bare-Mastra fallback = original plan (zero new cost). Bias toward cheap-recovery side ⇒ PR-blocking, not time-boxed.

## Consequences

**Positive:**
- Drop hand-roll: atomic state writer (edge 44) outside local mock CLI; `--resume` flag (edge 11); TF exp backoff (edge 28); per-repo lockfile (edge 40); `p-limit`. Inngest config covers each (orchestrator tasks 43–46).
- Crash / sleep resume = re-emit same event id; no per-run state-file dance.
- HITL pause = native event match; no file-watcher loop.
- Fan-out (Spring + React parallel) + per-key concurrency = config, not code.
- Cron / scheduled triggers (Phase 2 nightly Stryker) = config.
- Mastra Agent semantics intact (no per-tool step explosion → token cache + perf preserved).

**Negative:**
- New runtime dep (self-host Inngest server + Postgres + Redis later); operational surface grows.
- License (SSPL w/ delayed Apache) requires legal awareness if posture ever shifts toward SaaS / external offering — internal-only OK today.
- Outbound-verify gate (37a) blocks I3 merge until DoD met or 2-week escalation.
- Two observability sinks = two things to read on incidents (mitigated by ADR locking which is which).

**Neutral / accepted:**
- Mastra `suspend/resume` removed from primitive map — already TBD per vault `Build/Mastra Primitive Map`; no regression.
- Idempotency adds a cache table (laptop SQLite, prod Postgres) — small.
- Inngest UI port: laptop OK; prod = internal LAN host, no external exposure.

## Alternatives considered

| Option                                                          | Why rejected                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Inngest Cloud (SaaS)                                            | Hard org constraint: no SaaS, no outbound. Non-starter.                                            |
| Mastra-only (suspend/resume + own retries)                      | Suspend API TBD; would require hand-roll for retries / idempotency / fan-out / cron / event match. Reinvents Inngest poorly. |
| Hand-roll outer DAG (no Inngest)                                | Status quo; hand-rolls already enumerated above. Pays ongoing cost; Inngest is a clean lift.       |
| Both Inngest waits **and** Mastra suspend                       | Two HITL primitives = drift + footgun. Mastra suspend mid-step breaks Inngest bounded-step contract. |
| TF call = one Inngest step per call (per-tool wrapping)         | Step explosion under Agent tool-use loop; kills Mastra token cache + adds latency per hop.         |
| Drop audit JSONL hash chain in favor of Inngest history         | Inngest history is opaque ops trace, not tamper-evident security proof. Hash chain is security guarantee. |
| Single event `orch/run.requested` w/ `mode` payload field       | Distinct events = clearer routing, simpler concurrency keys, simpler dashboards.                   |
| Mastra Agent invocation split across N Inngest steps for HITL   | Re-introduces suspend semantics in disguise. Pure-fn checkpoint return is cleaner.                 |

## Affected specs / areas (orchestrator)

- `src/inngest/client.ts` + `serve.ts` — new (I2; tasks 36–37).
- `src/inngest/functions/orch-run.ts` — new (I3; task 38); event handlers + step orchestration.
- `src/tf/client.ts` — extend w/ idempotency cache `(runId, agentName, promptHash)` (I4; task 40).
- `src/runs/state.ts` — mark deprecated outside local mock CLI path (task 46).
- `src/cli/orchestrate.ts` — drop `--resume` flag (task 45); doc replay-by-event in README.
- `src/concurrency/` (if exists) — drop `p-limit` cap (task 43); declare on Inngest fn.
- `src/runs/lock.ts` (if exists) — drop per-repo lockfile (task 44); replace w/ `concurrency: { key: 'event.data.runId+repo' }`.
- `.env.example` — `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV=1`, `INNGEST_BASE_URL`; any telemetry-disable env vars discovered in 37a.
- `README.md` — `pnpm run inngest:dev`; observability table (Inngest UI vs JSONL); resume-by-replay note; `--system-trace-endpoint` forbidden-config note.
- Edge rows 10/11/28/40 in vault `Multi-Agent Orchestration PoC.md` — cite Inngest config rather than hand-roll.

## Revisit when

- Outbound-verify (37a) finds non-disable-able phone-home → kill switch this ADR; supersede w/ "Inngest rejected; bare-Mastra hand-roll" ADR.
- License posture changes (e.g. Inngest re-licenses server to AGPL, or company starts offering Inngest-as-a-service externally → SSPL trigger).
- Mastra ships first-class durable workflows + native event waits + own retry semantics across crashes → revisit whether two systems still warranted.
- Self-host operational cost (Postgres + Redis on internal infra) outweighs hand-roll in prod ⇒ consider lighter durability backing (e.g. SQLite-only single-node).
- Per-tool idempotency proves insufficient (e.g. Mastra Agents go non-deterministic at temp 0 due to provider drift) → revisit step granularity.

---

## Appendix A — outbound verification (37a)

**Status (orchestrator):** **GREEN with caveat** (mirrored 2026-05-04 from vault verdict 2026-05-03 against commit `acbefdc7575e4f9529c69f13d1925c45320d07b3`).

- **Source-grep half:** ran in vault, verdict GREEN; mirrored verbatim below as orchestrator-local record. **Re-runnable** here via `bash scripts/verify-inngest-outbound.sh` (auto-clones inngest/inngest at HEAD, greps `cmd/`+`pkg/`+`internal/`).
- **Manual tcpdump half:** **deferred** in vault, **deferred** here. **Owed before** any Inngest deployment outside the orchestrator laptop PoC + before ADR 0003-equivalent (self-host prod target) flips `proposed → accepted`.
- **Caveat propagation:** any I3+ merge against this orchestrator inherits the deferred-tcpdump caveat. PR description must cite this ADR + 37a status.

### DoD checklist

- [x] Source grep `inngest/inngest` server + CLI (not SDK) for `posthog|segment|mixpanel|sentry|amplitude|datadog|telemetry|analytics|api.inngest.com|inngest.cloud|phone.?home|usage.?metric`. **Triage below.** _Vault evidence; orchestrator re-run via `scripts/verify-inngest-outbound.sh` recommended on each Inngest server-version bump._
- [ ] `tcpdump` / Little Snitch — 5-min boot-idle capture. _Owed; fill below when run._
- [ ] 5-min steady-idle capture. _Owed._
- [ ] 5-min job-run capture (curl-trigger an event during window). _Owed._
- [x] Telemetry disable env vars: **none required** at default invocation. **Caveat:** do **not** set `--system-trace-endpoint` (or `OTEL_TRACES_COLLECTOR_ENDPOINT` env) to anything other than localhost. README + `.env.example` must document the opt-in flag must stay unset / localhost-bound.
- [x] Server commit sha verified: `acbefdc7575e4f9529c69f13d1925c45320d07b3` (vault clone 2026-05-04T00:13:57Z UTC from `https://github.com/inngest/inngest.git`). _Re-verify against new sha each Inngest version bump._
- [ ] Capture timestamps + destination list. _Owed (manual half)._
- [x] **Verdict (laptop PoC): GREEN (caveated)** — I3+I4+I5+I6 unblocked for laptop PoC merge. Tcpdump windows owed before any deployment beyond laptop.

### Source-grep findings (commit `acbefdc7`, mirrored from vault)

Roots scanned: `cmd/`, `pkg/`, `internal/` (SDK explicitly excluded — separate repo). Raw hits = 366 lines.

| Pattern | Hits | Verdict | Notes |
| ------- | ----:| ------- | ----- |
| `telemetry` | 565 | disable-able / off by default | All OpenTelemetry (`go.opentelemetry.io/otel/...` + internal `pkg/telemetry/{trace,metrics,redis_telemetry}`). Tracer default type = noop (TracerType iota=0 → `newNoopTraceProvider`, no exporter). `cmd/start/start.go:49` + `cmd/devserver/devserver.go:130` hardcode `TraceEndpoint = fmt.Sprintf("localhost:%d", port)` — OTLP HTTP exporter self-loops back to the same Inngest server. External collector requires explicit opt-in via `--system-trace-endpoint` flag (devserver) or `OTEL_TRACES_COLLECTOR_ENDPOINT` env. Default = localhost; no external destination. |
| `segment` | 10 | FP | Zero Segment.io references. All "URL segment" / "queue segment" / "JWT segment" wording in `pkg/event_trigger_patterns/`, `pkg/execution/queue/`, `pkg/connect/auth/`, `pkg/connect/state/`. |
| `sentry` | 9 | dead-code import, no outbound | `getsentry/sentry-go` imported in `pkg/logger/stdlib.go`. **Zero `sentry.Init` calls** across `cmd/`, `pkg/`, `internal/` (verified via `grep -rn 'sentry\.Init\|SENTRY_DSN'`). Without init, `sentry.CurrentHub().Client()` returns nil and report at `stdlib.go:359` is skipped. Also one TODO comment in `pkg/execution/batch/redis.go:177`. Could be removed for cleanliness; functionally inert. |
| `api.inngest.com` | 4 | FP for self-host runtime | (1) `pkg/inngest/client/client.go:12` — `InngestCloudAPI` const, used only by `pkg/inngest/clistate/clistate.go` which is **not** imported from `cmd/start` or `cmd/devserver` (verified via `grep -rn 'clistate\.\|"github.com/inngest/inngest/pkg/inngest/clistate"' cmd/`). Dead path during self-host operation. (2) `pkg/api/apiv1/apiv1auth/apiv1auth.go:15` — `RunClaimsIssuer = "api.inngest.com"` is a JWT `iss` claim **label**, not a URL fetched. (3) Two `pkg/api/v2/README.md` doc lines, not code. |
| `usage.?metric` | 1 | FP | Comment on `MetricsProvider` interface in `pkg/execution/checkpoint/checkpoint.go:60` — internal metrics interface, no outbound. |
| `posthog\|mixpanel\|amplitude\|datadog\|inngest.cloud\|phone.?home\|analytics` | 0 | clean | — |

**Source-grep verdict: GREEN.** No non-disable-able outbound destinations identified. Default invocation of `inngest start` / `inngest dev` self-loops OTel traces to localhost; Sentry is uninitialized; CLI Cloud client unreachable from server entry points.

**Caveats / scope:**
- Verdict covers code paths reached during `inngest start` + `inngest dev`. Does **not** cover `vendor/` deep-scan (Go modules — separate audit if posture demands), the JS UI bundle served at `:8288` (renders local data, no outbound — verify in tcpdump), or build-time tooling.
- `--system-trace-endpoint` must remain unset (or pointed at localhost). Document as forbidden config in orchestrator README when I2 lands.
- Sentry import could be removed upstream for cleanliness; not a 37a blocker.

### Manual half — deferred (run before prod promotion)

**Status:** not yet run in orchestrator context. Source-grep evidence accepted as sufficient for laptop PoC unblock; tcpdump windows owed before ADR 0003-equivalent (self-host prod target) flips `proposed` → `accepted`.

**Re-verify when:** orchestrator I2 wiring landed + Inngest dev server running locally — easiest moment to run captures w/ minimal setup overhead. Latest acceptable: at prod promotion (orchestrator's eventual self-host prod target ADR), against the prod binary commit sha, not just laptop dev.

**Sample commands (run when ready):**

```bash
# Terminal 1 — Inngest dev server (after I2 lands)
cd ~/dev/agent-orchestrator
pnpm run inngest:serve &           # orchestrator handler at :3030/api/inngest
pnpm run inngest:dev               # inngest-cli dev pointing at serve

# Terminal 2 — capture (Little Snitch UI works equivalently)
sudo tcpdump -i any -n 'not src localhost and not dst localhost and not src 192.168.0.0/16 and not dst 192.168.0.0/16' -w /tmp/inngest-37a-boot.pcap   # 5 min
# steady-idle window (no requests)
sudo tcpdump -i any -n 'not src localhost and not dst localhost and not src 192.168.0.0/16 and not dst 192.168.0.0/16' -w /tmp/inngest-37a-steady.pcap   # 5 min
# trigger a run via curl, capture during
curl -X POST http://127.0.0.1:8288/e/<event-key> -d '{"name":"orch/dry-plan.requested","data":{...}}'
sudo tcpdump -i any -n 'not src localhost and not dst localhost and not src 192.168.0.0/16 and not dst 192.168.0.0/16' -w /tmp/inngest-37a-run.pcap     # 5 min
```

**Per-window destination table (fill after run):**

| Window | Start (UTC) | End (UTC) | pcap path | Distinct destinations | Verdict |
| ------ | ----------- | --------- | --------- | --------------------- | ------- |
| boot-idle (5 min) | _fill_ | _fill_ | _fill_ | _fill — expected: empty / 127.0.0.1 / LAN_ | _fill_ |
| steady-idle (5 min) | _fill_ | _fill_ | _fill_ | _fill_ | _fill_ |
| job-run (5 min) | _fill_ | _fill_ | _fill_ | _fill_ | _fill_ |

Anything outside `127.0.0.1` / LAN (`192.168.0.0/16` or whatever this host's LAN block is) / Postgres+Redis hosts → triage as blocker / disable / FP and update verdict.

**Escalation:** if DoD (manual half) not met within 2 weeks of 37a start → decision recorded here (kill **or** narrow exception w/ egress firewall mitigation).
