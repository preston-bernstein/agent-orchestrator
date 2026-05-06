# CLAUDE.md — agent-orchestrator

Mirror `AGENTS.md` intent. Claude Code reads this file.

**Lane:** orchestrator repo only. Specs under `docs/specs/`.

**Boot:** `pnpm run orchestrate` — loads `docs/playbook-expectations.md` (A3 pin).

**Quality:** mirror `AGENTS.md` — **`pnpm run ci`** runs **`lint:base`**, **`lint:sonar`**, coverage, **`deps:cruise`**, **`debt:guard`**, **`size:guard`**, **`structure:guard`**, **`architecture:guard`** (parallel), then Istanbul/fallow; ESLint **`complexity` ≤10**, **`max-lines-per-function` ≤70**, **`max-lines` ≤400** (all `*.ts`/`*.tsx`, tests included); **`size:guard`** enforces maintainability target **`<=120` lines/file** across `src` + `tests` + `scripts` (allowlist-backed for existing debt); Sonar cognitive **≤12**; canonical story + Fallow **`health`** in **`docs/specs/2026-05-05-clean-code-enforcement/strict-profile.md`**. Layer boundaries: **`docs/specs/2026-05-05-clean-code-enforcement/layers.md`** + **`layerForbidden`** in `.dependency-cruiser.js`. **`pnpm run lint`** = merged ESLint config. **`pnpm run analyze:eslint`** = sequential ESLint lanes; **`pnpm run analyze:deps`** = **`deps:cruise`**. **`pnpm run fallow`** = fallow **`--production-dupes`**.

**Vault Build kit:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/Index.md`
