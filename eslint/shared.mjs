/** Shared ignore globs — keep in sync across eslint/core, eslint/sonar.*, and IDE root config. */
export const ignorePatterns = [
  "node_modules/**",
  "runs/**",
  "Orchestration PoC/**",
  "coverage/**",
  ".stryker-tmp-*/**",
  "reports/mutation/**",
  "**/*.d.ts",
];
