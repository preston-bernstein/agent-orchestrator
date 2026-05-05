# Agent instructions — agent-orchestrator

**Lane:** this repo only. No edits under `spring-api/` or `react-ui/` paths from here.

**Specs:** `docs/specs/<slug>/` — mirror vault `Orchestration PoC/Examples/docs/specs/` workflow. **NOT `fixtures/`** — that's runtime input for `--spec fixtures/<name>.md` (e.g. `fixtures/no-op.md` Phase 4 smoke).

**Quality:** **`pnpm run ci`** — same command **locally and in GitHub Actions** (six checks **in parallel** on one machine: typecheck, lint, coverage, fallow, `mutation:t0`, `mutation:wide`). Ordered logs / debugging: **`pnpm run ci:seq`**. Quick: **`pnpm run quality`** (no Stryker). Spot: `pnpm run test:run`. Coverage: `vitest.config.ts`. Stryker: `stryker.conf.json` (T0 slice) + `stryker.wide.conf.json` (**break ≥ 95**, **full `src/**`** minus T3 entrypoints; **equivalence mutators** listed in `mutator.excludedMutations` — see `_comment` there). Expand to full `check:fast` per vault Playbook Phase 1.

**Vault:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/` — prompts, patterns, Playbook.
