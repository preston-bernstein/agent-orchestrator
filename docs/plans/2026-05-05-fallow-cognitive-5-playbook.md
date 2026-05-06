# Playbook: `health.maxCognitive` → 5

**Today:** `.fallowrc.json` has `maxCognitive: 10`; `pnpm run fallow` is green.  
**Done when:** `maxCognitive: 5`, `pnpm run typecheck`, `pnpm run test:run`, and `pnpm run fallow` all green (same bar as `quality` minus lint/coverage if you slice locally).

## Merge gate

- **Source of truth:** `package.json` → `"fallow": "fallow --format compact"`.
- That is **combined** analysis (dead code, dupes, health, etc.), not `fallow health` alone.
- **`fallow health --ci`** = SARIF + `--fail-on-issues` + quiet. If anything ever runs only `health --ci` while `pnpm run fallow` still allows a higher cognitive cap, the two can diverge — keep **one** config threshold and verify both commands after changing `.fallowrc.json`.

## Inventory at cap 5 (29 findings, 18 files)

Copy config, set `health.maxCognitive` to `5`, run:

`pnpm exec fallow --format compact -c <path-to-temp-rc>`

Full list (sorted):

```
high-complexity:src/agents/integration.ts:108:runIntegration:cyclomatic=11,cognitive=10,severity=moderate
high-complexity:src/agents/supervisor.ts:124:findPathOverlap:cyclomatic=5,cognitive=10,severity=moderate
high-complexity:src/agents/supervisor.ts:318:runTaskGateFixLoop:cyclomatic=7,cognitive=8,severity=moderate
high-complexity:src/agents/supervisor.ts:370:runOneSupervisorTask:cyclomatic=5,cognitive=6,severity=moderate
high-complexity:src/agents/supervisor.ts:423:buildSupervisorFinalReturn:cyclomatic=8,cognitive=8,severity=moderate
high-complexity:src/agents/supervisor.ts:492:runSupervisor:cyclomatic=7,cognitive=6,severity=moderate
high-complexity:src/audit/jsonl.ts:108:scanLeak:cyclomatic=6,cognitive=6,severity=moderate
high-complexity:src/audit/jsonl.ts:83:findLeak:cyclomatic=6,cognitive=8,severity=moderate
high-complexity:src/audit/verify.ts:53:verifyChain:cyclomatic=5,cognitive=6,severity=moderate
high-complexity:src/cli/args.ts:52:parseArgs:cyclomatic=9,cognitive=7,severity=moderate
high-complexity:src/config/expectations.ts:108:assertVaultShaAllowed:cyclomatic=6,cognitive=7,severity=moderate
high-complexity:src/config/expectations.ts:33:parseSimpleYamlLine:cyclomatic=9,cognitive=7,severity=moderate
high-complexity:src/config/expectations.ts:78:loadExpectations:cyclomatic=9,cognitive=8,severity=moderate
high-complexity:src/config/managedRepos.ts:320:loadManagedRepoEntry:cyclomatic=6,cognitive=7,severity=moderate
high-complexity:src/gates/caveman.ts:109:collapseCompressedBlankRuns:cyclomatic=5,cognitive=8,severity=moderate
high-complexity:src/gates/runQuality.ts:104:defaultExec:cyclomatic=9,cognitive=9,severity=moderate
high-complexity:src/llm/assemblePrompt.ts:127:collectPromptSections:cyclomatic=11,cognitive=10,severity=moderate
high-complexity:src/llm/toonContext.ts:30:toToonSection:cyclomatic=6,cognitive=6,severity=moderate
high-complexity:src/planner/plannerDryRun.ts:67:plannerSpecsAllComplete:cyclomatic=5,cognitive=7,severity=moderate
high-complexity:src/reviewer/deterministic.ts:101:reviewFilesInDiff:cyclomatic=6,cognitive=9,severity=moderate
high-complexity:src/reviewer/deterministic.ts:35:unionOwnershipGlobsForSupervisor:cyclomatic=5,cognitive=6,severity=moderate
high-complexity:src/reviewer/diffPaths.ts:6:listUnifiedDiffRepoPaths:cyclomatic=7,cognitive=10,severity=moderate
high-complexity:src/tf/client.ts:112:request:cyclomatic=8,cognitive=7,severity=moderate
high-complexity:src/tf/client.ts:163:extractModelIds:cyclomatic=8,cognitive=10,severity=moderate
high-complexity:src/workflows/executeLane.ts:258:runExecuteLane:cyclomatic=10,cognitive=10,severity=moderate
high-complexity:src/workflows/integrationStep.ts:101:runIntegrationStep:cyclomatic=7,cognitive=6,severity=moderate
high-complexity:src/workflows/plannerBranch.ts:108:runPlannerBranch:cyclomatic=9,cognitive=8,severity=moderate
high-complexity:src/workflows/supervisorBranch.ts:225:aggregateStatusFromResults:cyclomatic=6,cognitive=9,severity=moderate
high-complexity:src/workflows/supervisorBranch.ts:264:runOneSupervisorGroup:cyclomatic=12,cognitive=10,severity=moderate
```

**Files only:** `integration.ts`, `supervisor.ts`, `jsonl.ts`, `verify.ts`, `args.ts`, `expectations.ts`, `managedRepos.ts`, `caveman.ts`, `runQuality.ts`, `assemblePrompt.ts`, `toonContext.ts`, `plannerDryRun.ts`, `deterministic.ts`, `diffPaths.ts`, `client.ts`, `executeLane.ts`, `integrationStep.ts`, `plannerBranch.ts`, `supervisorBranch.ts`.

## Phased attack (suggested PR order)

Principle: **shrink leaf-ish / pure helpers first** so call sites stay thin; **orchestration files last** (`supervisor`, `executeLane`, `supervisorBranch`) — they often need extracted phases/steps, not more nesting.

| Phase | Focus | Files |
|-------|--------|-------|
| 1 | Config + CLI parsing | `expectations.ts`, `managedRepos.ts`, `args.ts` |
| 2 | Isolated utilities | `toonContext.ts`, `plannerDryRun.ts`, `caveman.ts` (gates), `jsonl.ts`, `verify.ts` |
| 3 | I/O + TF | `tf/client.ts` (`request`, `extractModelIds`) |
| 4 | Quality gate runner | `gates/runQuality.ts` (`defaultExec`) |
| 5 | LLM assembly | `assemblePrompt.ts` |
| 6 | Reviewer | `diffPaths.ts`, `deterministic.ts` |
| 7 | Workflows | `integrationStep.ts`, `plannerBranch.ts`, `supervisorBranch.ts`, `executeLane.ts` |
| 8 | Agents | `integration.ts`, `supervisor.ts` |

Within a file: fix **highest cognitive first** (often collapses secondary hotspots).

## Per-PR checklist

1. Refactor to ≤5 cognitive (and watch cyclomatic if it is also near cap — `maxCyclomatic` is 26 today).
2. `pnpm run typecheck` && `pnpm run test:run`.
3. `pnpm exec fallow --format compact -c <rc-with-5>` — expect shrinking finding list; final PR has **repo `.fallowrc.json`** at `5` and `pnpm run fallow` green.

## Definition of done

- [ ] `health.maxCognitive: 5` in `.fallowrc.json` (no temporary cap hacks).
- [ ] `pnpm run fallow` exit 0.
- [ ] `pnpm run typecheck` && `pnpm run test:run` green.
- [ ] If CI runs `fallow health --ci` separately, one verification run with `--max-cognitive 5` or same rc so SARIF path matches.

## Note on ignores

`.fallowrc.json` already ignores some entry/heavy files under `health.ignore`. Prefer **not** expanding ignores for this push; goal is real decomposition.
