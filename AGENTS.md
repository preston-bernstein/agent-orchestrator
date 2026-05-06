# Agent instructions — agent-orchestrator

**Lane:** this repo only. No edits under `spring-api/` or `react-ui/` paths from here.

**Specs:** `docs/specs/<slug>/` — mirror vault `Orchestration PoC/Examples/docs/specs/` workflow. **NOT `fixtures/`** — that's runtime input for `--spec fixtures/<name>.md` (e.g. `fixtures/no-op.md` Phase 4 smoke).

**Quality:** **`pnpm run ci`** — same command **locally and in GitHub Actions** (parallel wave: typecheck, **`lint:base`** + **`lint:sonar`** (SonarJS), coverage, **`knip`**, **`deps:cruise`** [dependency-cruiser strict graph rules on `src/`; host Node outside DC range uses `npx node@22` then madge fallback]; then Istanbul + fallow+jscpd; then `mutation:t0` + `mutation:wide`). Local one-shot ESLint (core + Sonar): **`pnpm run lint`**. Sequential ESLint like CI: **`pnpm run analyze:eslint`**. Package + graph gate: **`pnpm run analyze:deps`** (`knip` then **`deps:cruise`**). Ordered logs / debugging: **`pnpm run ci:seq`**. Quick: **`pnpm run quality`** (no Stryker). Spot: `pnpm run test:run`. Coverage: `vitest.config.ts`. Stryker: `stryker.conf.json` (T0 slice) + `stryker.wide.conf.json` (**break ≥ 95**, **full `src/**`** minus T3 entrypoints; **equivalence mutators** listed in `mutator.excludedMutations` — see `_comment` there). Expand to full `check:fast` per vault Playbook Phase 1.

**Dependency graph:** `.dependency-cruiser.js` extends **`recommended-strict`** (severity **error**); **`not-to-unresolvable`** omitted (native addons e.g. better-sqlite3). **`scripts/deps-validate.mjs`** runs **`deps:cruise`**.

**Duplication:** **Fallow** `duplicates.threshold` (**5**) = minimum **lines per duplicate block**, not a percent. **`pnpm run fallow`** runs fallow then **jscpd** on **`src/`**, **`scripts/`**, **`tests/`**. `.jscpd.json`: **`threshold`** (**5**) = max **duplicate-line %**; **`minLines`** (**7**) = smallest clone counted toward that % (filters short Vitest/setup repeats; fallow still flags **≥5**-line blocks). Verbose jscpd (no % fail): **`pnpm run dup:jscpd`**.

**Vault:** `Development/Vibe Coding Hardening/Orchestration PoC/Build/` — prompts, patterns, Playbook.
