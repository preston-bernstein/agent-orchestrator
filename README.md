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

## PLAYBOOK_EXPECTS (stub)

Match `docs/playbook-expectations.md` frontmatter; optional env `EXPECTED_VAULT_SHA` + `STRICT_EXPECTATIONS=1` for strict check.
