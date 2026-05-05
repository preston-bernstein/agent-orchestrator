import { defineConfig } from "vitest/config";

/**
 * Coverage tiers (see also `stryker.conf.json` T0 vs `stryker.wide.conf.json`):
 * - T0: refusal / egress / audit integrity — strict 90 (policy slightly relaxed on branches).
 * - T1: runs, workflows, planner, gates, non-env config — firm ~80–88.
 * - T2: agents, reviewer, stacks, scorecard aggregate, approval formatting — moderate ~80–93.
 * - Default floor: 90 / 85 (lines·stmts·funcs / branches). Tier T3 entrypoints stay excluded.
 */

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/egressGuard.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/cli/orchestrate.ts",
        "src/inngest/**",
        "src/llm/toonContext.ts",
        "src/audit/verify.ts",
        "src/scorecard/index.ts",
        "src/scorecard/format.ts",
        "src/reviewer/index.ts",
        "src/runs/loadSpec.ts",
        "src/approval/index.ts",
        "src/stacks/types.ts",
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,

        // T0 — trust / refusal / tamper / egress
        "src/audit/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/tf/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/policy/**": {
          lines: 89,
          statements: 89,
          functions: 90,
          branches: 85,
        },
        "src/llm/assemblePrompt.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/cli/args.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/config/env.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },

        // T1 — orchestration / workflow glue
        "src/config/expectations.ts": {
          lines: 72,
          statements: 72,
          functions: 100,
          branches: 45,
        },
        "src/config/managedRepos.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 85,
        },
        "src/runs/**": {
          lines: 88,
          statements: 88,
          functions: 95,
          branches: 65,
        },
        "src/workflows/**": {
          lines: 88,
          statements: 88,
          functions: 95,
          branches: 78,
        },
        "src/planner/**": {
          lines: 88,
          statements: 88,
          functions: 70,
          branches: 85,
        },
        "src/gates/**": {
          lines: 80,
          statements: 80,
          functions: 85,
          branches: 78,
        },

        // T2 — agents / reviewer / stacks / scorecard / approval
        "src/agents/**": {
          lines: 88,
          statements: 88,
          functions: 88,
          branches: 82,
        },
        "src/reviewer/**": {
          lines: 93,
          statements: 93,
          functions: 100,
          branches: 75,
        },
        "src/stacks/**": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/scorecard/aggregate.ts": {
          lines: 94,
          statements: 94,
          functions: 100,
          branches: 78,
        },
        "src/approval/formatApprovalArtifacts.ts": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 88,
        },
      },
    },
  },
});
