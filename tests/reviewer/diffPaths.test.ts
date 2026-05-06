import { describe, expect, it } from "vitest";
import { diffChurnByFile, listUnifiedDiffRepoPaths } from "../../src/reviewer/diffPaths.js";

describe("reviewer/diffPaths", () => {
  const sample = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1,2 @@",
    " x",
    "+y",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "+only added",
  ].join("\n");

  it("listUnifiedDiffRepoPaths collects +++ paths", () => {
    expect(listUnifiedDiffRepoPaths(sample).sort()).toEqual(
      ["src/a.ts", "src/b.ts"].sort(),
    );
  });

  it("diffChurnByFile ignores /dev/null target when file is added", () => {
    const diff = [
      "diff --git a/none b/src/a.ts",
      "--- /dev/null",
      "+++ b/src/a.ts",
      "+x",
    ].join("\n");
    expect(diffChurnByFile(diff)).toEqual([
      { file: "src/a.ts", plus: 1, minus: 0 },
    ]);
  });

  it("diffChurnByFile drops current file on +++ /dev/null (delete hunk header)", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ /dev/null",
      "-onlyRemoved",
    ].join("\n");
    expect(diffChurnByFile(diff)).toEqual([]);
  });
});
