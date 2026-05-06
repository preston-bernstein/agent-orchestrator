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

describe("approval/formatApprovalArtifacts", () => {
  it("writes md + json w/ diff_hash", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "spring-T1",
        spec_slug: "feat",
        repo: "spring-api",
        supervisor: "spring",
        title: "task",
        paths: ["src/**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
    const diffText = [
      "diff --git a/src/A.java b/src/A.java\n",
      "+++ b/src/A.java\n",
      "+x\n",
    ].join("");
    const { mdPath, jsonPath, payload } = formatApprovalArtifacts({
      runId: "run-1",
      runDir: tmp,
      supervisorId: "spring",
      diffText,
      reviewer,
      plan,
      integrationNote: "compatible · proceed",
    });
    expect(readFileSync(mdPath, "utf8")).toMatch(/^# Approval — spring/m);
    expect(readFileSync(jsonPath, "utf8")).toContain('"diff_hash"');
    expect(payload.diff_hash).toHaveLength(64);
    expect(payload.supervisor).toBe("spring");
    expect(payload.integration_note).toBe("compatible · proceed");
    expect(payload.pending_diff_rel).toBe("spring/pending.diff");
  });

});

describe("approval/formatApprovalArtifacts churn summary", () => {
  it("aggregates +/- churn across multiple files (md diff stat line)", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "spring-T1",
        spec_slug: "feat",
        repo: "spring-api",
        supervisor: "spring",
        title: "task",
        paths: ["src/**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
    const diffText = [
      "diff --git a/src/A.java b/src/A.java\n",
      "+++ b/src/A.java\n",
      "+a1\n",
      "-a0\n",
      "diff --git a/src/B.java b/src/B.java\n",
      "+++ b/src/B.java\n",
      "+b1\n",
      "-b0\n",
    ].join("");
    const { mdPath } = formatApprovalArtifacts({
      runId: "run-churn",
      runDir: tmp,
      supervisorId: "spring",
      diffText,
      reviewer,
      plan,
    });
    const md = readFileSync(mdPath, "utf8");
    expect(md).toMatch(/Diff: `2\+\/2-`/);
  });
});
