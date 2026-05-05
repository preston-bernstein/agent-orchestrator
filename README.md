# agent-orchestrator

PoC bootstrap — **Mastra + optional Inngest** land later per vault `Orchestration PoC/Build/Playbook.md`.

## Quick start

```bash
cd ~/dev/agent-orchestrator
pnpm install
cp .env.example .env   # optional for now
pnpm run test:run
pnpm run orchestrate
```

## Vault canon

- Playbook + fidelity: `Home Network Vault` → `Development/Vibe Coding Hardening/Orchestration PoC/Build/`
- Fill `docs/playbook-expectations.md` → `vault_git_sha` from vault `git rev-parse HEAD`

## Scripts

| Script | Purpose |
| ------ | ------- |
| `pnpm run orchestrate` | Boot + load expectations + JSON status |
| `pnpm run test:run` | Vitest |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | ESLint flat config, `--max-warnings=0` |
| `pnpm run quality` | typecheck + lint + tests (Phase 10 gate) |
| `pnpm run coverage` | Vitest w/ v8 coverage; `src/audit/**` ≥ 90%, rest ≥ 70% |
| `pnpm run audit:verify <path>` | Verify audit JSONL hash chain |
| `pnpm run scorecard` | Aggregate runs/<id>/audit.jsonl into PoC scorecard |
| `pnpm run inngest:serve` | Boot Hono handler at `:3030/api/inngest` (I2 — empty fn array until I3) |
| `pnpm run inngest:dev` | `npx inngest-cli@latest dev -u http://127.0.0.1:3030/api/inngest` (paired w/ `inngest:serve`) |
| `pnpm run verify:inngest-outbound` | 37a source-grep half — clones inngest/inngest, prints triage table |

## PLAYBOOK_EXPECTS (A3 pin-the-brain)

Full checklist + bump procedure: `docs/playbook-expectations.md`. Must stay aligned w/ block below — drift = chore commit on both.

```yaml
PLAYBOOK_EXPECTS:
  vault_repo_label: "Home Network Vault"
  vault_git_sha: "15079571ebd9d52fcf77dd84ff06f67d69d3b941"
  vault_cut_date: "2026-05-04"
  playbook_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook.md"
  fidelity_plan_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook Fidelity Plan.md"
```

Optional env: `EXPECTED_VAULT_SHA=<sha>` + `STRICT_EXPECTATIONS=1` → boot throws on mismatch.

## Inngest (I2 — outer durable shell, dev-only at this commit)

Per **ADR 0002** (`docs/decisions/2026-05-04-0002-inngest-outer-durable-shell.md`)
+ vault `Orchestration PoC/Inngest Integration Plan.md`. Inngest **Cloud rejected**
(hard internal-only constraint); self-host only. Laptop today; internal LAN +
own Postgres + Redis for prod-later (deferred ADR — to land at task 42).

### Dev wiring

```bash
pnpm install                       # pulls inngest, hono, @hono/node-server
cp .env.example .env               # fill INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY locally
pnpm run inngest:serve             # mounts handler at :3030/api/inngest
pnpm run inngest:dev               # second terminal — Inngest dev UI on :8288
```

**I2 = handshake only.** `src/inngest/serve.ts` registers an empty `functions`
array — dev UI shows the app w/ zero functions. `orch-run` (the first real
event handler) lands at **I3** (task 38), gated on prod-binary 37a re-run.

### 37a — outbound-verify gate (PR-blocks I3)

DoD checklist + evidence: ADR 0002 Appendix A. Laptop PoC fully GREEN
2026-05-04 / 2026-05-05 (source-grep + tcpdump 3-window — zero outbound).
Sha-alignment + execution-path caveats propagate to I3+ PRs.

```bash
pnpm run verify:inngest-outbound   # source-grep half — automatable
```

Manual half (operator): `tcpdump` 3 windows × 5 min (boot-idle / steady-idle /
job-run); record commit sha + timestamps in ADR Appendix A.
