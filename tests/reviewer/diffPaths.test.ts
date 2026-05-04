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

  it("diffChurnByFile counts +/- lines", () => {
    const churn = diffChurnByFile(sample);
    const a = churn.find((c) => c.file === "src/a.ts");
    const b = churn.find((c) => c.file === "src/b.ts");
    expect(a).toEqual({ file: "src/a.ts", plus: 1, minus: 0 });
    expect(b).toEqual({ file: "src/b.ts", plus: 1, minus: 0 });
  });
});
