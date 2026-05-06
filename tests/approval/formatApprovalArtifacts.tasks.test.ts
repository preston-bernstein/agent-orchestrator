import { readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { formatApprovalArtifacts } from "../../src/approval/formatApprovalArtifacts.js";
import {
  approvalTmpDir as tmp,
  mkdirTmp,
  mkPlan,
  reviewerPass,
} from "./formatApprovalArtifacts.fixtures.js";

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("approval/formatApprovalArtifacts task listing", () => {
  it("dedupes spec_slugs and only lists tasks for this supervisor", () => {
    mkdirTmp();
    const plan = mkPlan([
      { id: "a1", spec_slug: "x", repo: "spring-api", supervisor: "spring", title: "ta", paths: ["**"], depends_on: [] },
      { id: "a2", spec_slug: "x", repo: "spring-api", supervisor: "spring", title: "tb", paths: ["**"], depends_on: [] },
      { id: "other", spec_slug: "y", repo: "react-ui", supervisor: "react", title: "skip", paths: ["**"], depends_on: [] },
    ]);
    const { payload, mdPath } = formatApprovalArtifacts({
      runId: "run-4",
      runDir: tmp,
      supervisorId: "spring",
      diffText: "diff --git a/z b/z\n+++ b/z\n+z\n",
      reviewer: reviewerPass(),
      plan,
    });
    expect(payload.spec_slugs).toEqual(["x"]);
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("- [ ] a1 ta");
    expect(md).toContain("- [ ] a2 tb");
    expect(md).not.toContain("other");
  });

  it("(no tasks) renders placeholder and unknown spec in header", () => {
    mkdirTmp();
    const mdPath = formatApprovalArtifacts({
      runId: "run-5",
      runDir: tmp,
      supervisorId: "solo",
      diffText: "",
      reviewer: reviewerPass({ fast: "skipped", heavy: "skipped" }),
      plan: mkPlan([]),
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("- _(no tasks)_");
    expect(md).toMatch(/Spec: `\?`/);
  });
});
