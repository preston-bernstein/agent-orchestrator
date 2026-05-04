import { defineConfig } from "vitest/config";

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
        "src/cli/**",
        "src/inngest/**",
        // CLI/script entrypoints (no logic worth covering separately).
        "src/audit/verify.ts",
        "src/scorecard/index.ts",
        "src/scorecard/format.ts",
        "src/reviewer/index.ts",
        "src/runs/loadSpec.ts",
        "src/approval/index.ts",
        "src/stacks/types.ts",
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
        // src/audit/** is the security-critical chain — vault canon
        // (Build/Audit Hash Chain) calls for ≥ 90%.
        "src/audit/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
      },
    },
  },
});
