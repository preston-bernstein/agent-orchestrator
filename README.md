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
