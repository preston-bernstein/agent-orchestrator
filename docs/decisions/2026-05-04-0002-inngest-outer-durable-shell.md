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

`accepted` — **laptop PoC fully GREEN** (37a manual half ran 2026-05-05 against `inngest dev` v1.19.1 build `dfcc1f544` — zero outbound across all 3 windows; see Appendix A). **Caveated for prod promotion** until source-grep + tcpdump align on a single prod-binary commit sha + full-execution-path job-run window (registered SDK function, not just ingest) is re-run.

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

**Status (orchestrator):** **laptop-PoC GREEN** (2026-05-05) — both halves ran:

- **Source-grep half:** ran in vault 2026-05-03 against commit `acbefdc7575e4f9529c69f13d1925c45320d07b3`; verdict GREEN; mirrored verbatim below as orchestrator-local record. Re-runnable here via `bash scripts/verify-inngest-outbound.sh` (auto-clones inngest/inngest at HEAD; greps `cmd/`+`pkg/`+`internal/`).
- **Manual tcpdump half:** ran in orchestrator 2026-05-05 against installed `inngest` v1.19.1 build sha `dfcc1f544` (3 windows × 5 min: boot-idle / steady-idle / job-run). **Zero outbound packets** across all 3 windows. Per-window evidence below.
- **Sha-alignment caveat:** source-grep covered `acbefdc7`; tcpdump covered `dfcc1f544`. Code drift between shas is plausible (~1 day apart in vault timeline; longer in real time). Acceptable for laptop PoC; **prod promotion gate must re-grep at the prod-binary sha** before flipping any "self-host prod target" ADR `proposed → accepted`.
- **Execution-path caveat:** job-run window exercised **ingest path + UI poll surface only** (5x "Send test event" via Inngest dev UI; no SDK function registered, so events ingested but never executed). Full per-job execution outbound surface owed at I3 (when `orch-run` Inngest fn registers).
- **Caveat propagation:** any I3+ merge against this orchestrator still inherits the sha-alignment + execution-path caveats. PR description must cite this ADR + status.

### DoD checklist

- [x] Source grep `inngest/inngest` server + CLI (not SDK) for `posthog|segment|mixpanel|sentry|amplitude|datadog|telemetry|analytics|api.inngest.com|inngest.cloud|phone.?home|usage.?metric`. **Triage below.** _Vault evidence vs `acbefdc7`; orchestrator re-run via `scripts/verify-inngest-outbound.sh` recommended on each Inngest server-version bump._
- [x] `tcpdump` — 5-min boot-idle capture. **0 packets matched filter** (`/tmp/inngest-37a-boot.pcap` 0B). Filter excluded localhost + `192.168.0.0/16` + multicast. Run 2026-05-05T00:49:08Z–00:54:08Z (kill mechanism wonky on this attempt — actual end ~00:57:22Z; second-attempt steady+run used clean `-G 300 -W 1` self-exit).
- [x] 5-min steady-idle capture. **0 packets matched filter** (104,852 packets received-by-filter and excluded; 10,965 kernel drops — see "Buffer caveat" below). Run 2026-05-05T01:00:14Z–01:05:14Z.
- [x] 5-min job-run capture (5x "Send test event" via Inngest dev UI + tab navigation during window). **0 packets matched filter** (71,060 received-by-filter excluded; **0 kernel drops** w/ `-B 4096`). Run 2026-05-05T01:12:53Z–01:17:53Z.
- [x] Telemetry disable env vars: **none required** at default invocation. **Caveat:** do **not** set `--system-trace-endpoint` (or `OTEL_TRACES_COLLECTOR_ENDPOINT` env) to anything other than localhost. README + `.env.example` must document the opt-in flag must stay unset / localhost-bound.
- [x] Server commit sha verified — **two shas due to sha-alignment caveat above:**
  - Source-grep evidence: `acbefdc7575e4f9529c69f13d1925c45320d07b3` (vault clone 2026-05-04T00:13:57Z UTC).
  - Tcpdump evidence: `dfcc1f544` (installed `inngest` CLI v1.19.1 reported via `inngest version` 2026-05-05T00:45:52Z UTC).
- [x] Capture timestamps + destination list. **Filled below.**
- [x] **Verdict (laptop PoC): GREEN** — I3+I4+I5+I6 unblocked for laptop PoC merge. Sha-alignment + execution-path re-runs owed before prod promotion (see Status block above).

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

### Manual half — laptop PoC run (2026-05-05)

**Operator:** Preston (orchestrator dev box, macOS). **Inngest binary:** `inngest` CLI v1.19.1 build `dfcc1f544`, installed via npm/brew (whichever resolved first; orchestrator does not yet have its own Inngest install path — laptop-global is fine for 37a).

**Setup:**
- Single terminal: `cd /tmp && inngest dev 2>&1 | tee /tmp/inngest-dev.log`
- Server bound `0.0.0.0:8288` (HTTP/UI) + `:50052` (gRPC connect-gateway). **Network-posture caveat:** `0.0.0.0` binding means LAN-reachable; prod must firewall or rebind to `127.0.0.1`. Not a phone-home issue but flagged for I2/I6 readme.
- LAN block on this host: `192.168.1.149/24` (covered by `192.168.0.0/16` filter).

**Capture method:** macOS `tcpdump -i any -n -G 300 -W 1` (self-exits cleanly after one 5-min window; first attempt used `&` + `sudo kill` which raced — stuck sudo wrapper survived 8+ min until manual `kill -9`). For job-run, added `-B 4096` (4MB ringbuffer) — eliminated kernel drops.

**Filter (single line):** `not src localhost and not dst localhost and not src 192.168.0.0/16 and not dst 192.168.0.0/16 and not src 224.0.0.0/4 and not dst 224.0.0.0/4 and not src ff00::/8 and not dst ff00::/8`

**Sanity check (10-sec unfiltered):** captured 8937 packets / 8.7 MB / 0 kernel drops. Confirms tcpdump itself functional on this host; subsequent 0-byte filtered pcaps reflect filter exclusion, not tooling failure.

**Per-window evidence:**

| Window | Start (UTC) | End (UTC) | pcap | Captured | Filter-received (excluded) | Kernel drops | Distinct outbound destinations | Verdict |
| ------ | ----------- | --------- | ---- | --------:| --------------------------:| ------------:| ------------------------------ | ------- |
| boot-idle (5 min) | 2026-05-05T00:49:08Z | 2026-05-05T00:54:08Z (kill raced — process actually ended ~00:57:22Z) | `/tmp/inngest-37a-boot.pcap` (0B) | 0 | n/a (first capture; wonky kill — see method note) | n/a | **none** | GREEN |
| steady-idle (5 min) | 2026-05-05T01:00:14Z | 2026-05-05T01:05:14Z | `/tmp/inngest-37a-steady.pcap` (0B) | 0 | 104,852 | 10,965 (small ringbuffer; raised to 4MB for job-run) | **none** | GREEN |
| job-run (5 min, 5x "Send test event" + UI tab navigation) | 2026-05-05T01:12:53Z | 2026-05-05T01:17:53Z | `/tmp/inngest-37a-run.pcap` (0B) | 0 | 71,060 | **0** | **none** | GREEN |

**Triage commands used (per pcap):**

```bash
sudo tcpdump -r /tmp/inngest-37a-<window>.pcap -nn 2>/dev/null | wc -l                                                # packet count
sudo tcpdump -r /tmp/inngest-37a-<window>.pcap -nn 2>/dev/null | awk '{print $3, "->", $5}' | sed 's/\.[0-9]*$//' | sort -u   # distinct destinations
```

**Buffer caveat (steady-idle):** 10,965 packets dropped by kernel during the steady-idle 5-min window (default 2MB ringbuffer overflowed against ~350 pkt/s LAN+localhost firehose). **Drops are statistically all-LAN/localhost** (~100% of dev-machine traffic is LAN+localhost; tcpdump drops uniformly across received packets), but strict-rigor cannot prove zero drops were outbound. **Mitigated** in job-run window by `-B 4096` (4MB) → 0 drops. **Re-run pre-prod:** use `-B 4096` on all 3 windows for clean evidence.

**Aggregate verdict (laptop PoC): GREEN.** Zero outbound packets to non-localhost / non-LAN / non-multicast destinations across 15 minutes of `inngest dev` runtime spanning boot, idle, and ingest+UI activity. Inngest dev server makes no phone-home calls under default invocation.

**Re-verify when:**
- Inngest CLI version bump (re-run all 3 windows + source-grep at new sha).
- Orchestrator I2 lands (`src/inngest/{client,serve}.ts` + own SDK app registers w/ dev server) — re-run **job-run window only** to exercise full per-job execution outbound surface (current job-run was ingest-path-only since no SDK fn registered).
- Promotion to prod self-host (`inngest start` on internal LAN w/ Postgres + Redis) — full 3-window re-run against prod-binary sha; sha-alignment with source-grep mandatory at this gate.

**Escalation:** if any future re-run finds non-disable-able outbound → kill switch this ADR; supersede w/ "Inngest rejected; bare-Mastra hand-roll" ADR (zero new cost — bare-Mastra is the original plan).
