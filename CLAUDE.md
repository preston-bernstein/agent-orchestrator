# CLAUDE.md — agent-orchestrator

Mirror `AGENTS.md` intent. Claude Code reads this file.

**Lane:** orchestrator repo only. Specs under `docs/specs/`.

**Boot:** `pnpm run orchestrate` — loads `docs/playbook-expectations.md` (A3 pin).

**Quality:** mirror `AGENTS.md` — CI matrix runs typecheck, lint, coverage, fallow, Stryker T0 + wide **in parallel**; local `pnpm run ci` is sequential.

**Vault Build kit:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/Index.md`
