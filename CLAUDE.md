# CLAUDE.md — agent-orchestrator

Mirror `AGENTS.md` intent. Claude Code reads this file.

**Lane:** orchestrator repo only. Specs under `docs/specs/`.

**Boot:** `pnpm run orchestrate` — loads `docs/playbook-expectations.md` (A3 pin).

**Quality:** mirror `AGENTS.md` — **`pnpm run ci`** runs **`lint:base`**, **`lint:sonar`**, coverage, **`knip`**, **`deps:cruise`** (parallel), then Istanbul/fallow. **`pnpm run lint`** = merged ESLint config. **`pnpm run analyze:eslint`** = sequential ESLint lanes; **`pnpm run analyze:deps`** = `knip` + **`deps:cruise`**. **`pnpm run fallow`** = fallow + jscpd (`src`+`scripts`+`tests`, 5% line cap, **minLines 7** for jscpd %). Verbose: **`pnpm run dup:jscpd`**.

**Vault Build kit:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/Index.md`
