import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatApprovalArtifacts } from "../../src/approval/formatApprovalArtifacts.js";
import { ReviewerOutput, type ReviewerFindingT } from "../../src/reviewer/schema.js";
import { approvalTmpDir as tmp, mkdirTmp, mkPlan } from "./formatApprovalArtifacts.fixtures.js";

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("approval/formatApprovalArtifacts integration note handling", () => {
  it("omits integration_note in payload when not passed; md uses n/a line", () => {
    mkdirTmp();
    const plan = mkPlan([{ id: "spring-T1", spec_slug: "feat", repo: "spring-api", supervisor: "spring", title: "t1", paths: ["src/**"], depends_on: [] }]);
    const reviewer = ReviewerOutput.parse({ status: "pass", rationale: "ok", findings: [], gate_summary: { fast: "pass", heavy: "skipped" } });
    const { jsonPath, payload } = formatApprovalArtifacts({ runId: "run-2", runDir: tmp, supervisorId: "spring", diffText: "diff --git a/a b/a\n+++ b/a\n", reviewer, plan });
    expect("integration_note" in payload).toBe(false);
    expect(readFileSync(jsonPath, "utf8")).not.toContain("integration_note");
    const md = readFileSync(path.join(tmp, "spring", "approval-prompt.md"), "utf8");
    expect(md).toContain("- _(n/a or skipped)_");
  });
});

describe("approval/formatApprovalArtifacts findings and task lists", () => {
  it("filters + sorts findings: in-diff only; error before warning; file order", () => {
    mkdirTmp();
    const plan = mkPlan([{ id: "spring-T1", spec_slug: "s", repo: "spring-api", supervisor: "spring", title: "t", paths: ["src/**"], depends_on: [] }]);
    const reviewer = ReviewerOutput.parse({
      status: "pass_with_warnings",
      rationale: "w",
      findings: [
        { severity: "warning", rule: "w1", file: "src/B.java", line: 9, message: "b" },
        { severity: "error", rule: "e1", file: "src/A.java", line: 3, message: "a" },
        { severity: "info", rule: "orphan", file: "other/C.java", line: 1, message: "c" },
        { severity: "info", rule: "global", message: "no file" },
      ],
      gate_summary: { fast: "pass", heavy: "fail" },
    });
    const diffText = ["diff --git a/src/A.java b/src/A.java\n+++ b/src/A.java\n+x\n", "diff --git a/src/B.java b/src/B.java\n+++ b/src/B.java\n+y\n"].join("\n");
    const { payload, mdPath } = formatApprovalArtifacts({ runId: "run-3", runDir: tmp, supervisorId: "spring", diffText, reviewer, plan });
    const outFindings = payload.findings as ReviewerFindingT[];
    expect(outFindings).toHaveLength(3);
    expect(outFindings[0]!.severity).toBe("error");
    expect(outFindings[1]!.severity).toBe("warning");
    expect(outFindings[2]!.rule).toBe("global");
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("error · e1 · src/A.java:3");
    expect(md).toContain("warning · w1 · src/B.java:9");
    expect(md).toContain("info · global ·");
  });
});
