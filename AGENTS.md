# Agent instructions — agent-orchestrator

**Lane:** this repo only. No edits under `spring-api/` or `react-ui/` paths from here.

**Specs:** `docs/specs/<slug>/` — mirror vault `Orchestration PoC/Examples/docs/specs/` workflow. **NOT `fixtures/`** — that's runtime input for `--spec fixtures/<name>.md` (e.g. `fixtures/no-op.md` Phase 4 smoke).

**Quality:** **GitHub Actions** runs **six checks in parallel** (typecheck, lint, coverage, fallow, `mutation:t0`, `mutation:wide`) — see `.github/workflows/ci.yml`. **`pnpm run ci`** runs the same commands **locally in sequence**. Faster: **`pnpm run quality`** (no Stryker). Spot: `pnpm run test:run`. Coverage tiers: `vitest.config.ts`. Mutation wide: `stryker.wide.conf.json` (**break ≥ 70**; defers `expectations.ts`, `RunContext.ts`, `aggregate.ts`). Expand to full `check:fast` per vault Playbook Phase 1.

**Vault:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/` — prompts, patterns, Playbook.
