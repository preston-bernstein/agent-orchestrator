import { describe, expect, test } from "vitest";

async function loadConfig(path: string): Promise<unknown[]> {
  const mod = (await import(path)) as { default?: unknown };
  if (!Array.isArray(mod.default)) {
    throw new Error(`expected ESLint config array from ${path}`);
  }
  return mod.default;
}

function findTsRuleBlock(config: readonly unknown[]): Record<string, unknown> {
  const block = config.find(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "rules" in entry &&
      !("files" in entry) &&
      "max-lines" in ((entry as { rules?: Record<string, unknown> }).rules ?? {}),
  ) as { rules?: Record<string, unknown> } | undefined;
  if (!block?.rules) throw new Error("core base rule block not found");
  return block.rules;
}

function findTestOverride(
  config: readonly unknown[],
): { rules?: Record<string, unknown> } | undefined {
  return config.find(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "files" in entry &&
      Array.isArray((entry as { files?: unknown[] }).files) &&
      ((entry as { files: unknown[] }).files.includes("tests/**/*.ts") ||
        (entry as { files: unknown[] }).files.includes("**/*.test.ts")),
  ) as { rules?: Record<string, unknown> } | undefined;
}

describe("deterministic size enforcement config", () => {
  test("enforces max-lines and function/complexity caps for all TS", async () => {
    const coreConfig = await loadConfig("../../eslint/core.config.mjs");
    const rules = findTsRuleBlock(coreConfig);
    expect(rules["complexity"]).toEqual(["error", { max: 10 }]);
    expect(rules["max-lines-per-function"]).toEqual([
      "error",
      { max: 70, skipBlankLines: true, skipComments: true },
    ]);
    expect(rules["max-lines"]).toEqual([
      "error",
      { max: 400, skipBlankLines: true, skipComments: true },
    ]);
  });

  test("does not disable complexity or max-lines-per-function in tests", async () => {
    const coreConfig = await loadConfig("../../eslint/core.config.mjs");
    const testOverride = findTestOverride(coreConfig);
    expect(testOverride?.rules?.complexity).toBeUndefined();
    expect(testOverride?.rules?.["max-lines-per-function"]).toBeUndefined();
  });

  test("does not disable sonar cognitive complexity in tests", async () => {
    const sonarFragment = await loadConfig("../../eslint/sonar.fragment.mjs");
    const testOverride = findTestOverride(sonarFragment);
    expect(testOverride?.rules?.["sonarjs/cognitive-complexity"]).toBeUndefined();
  });
});
