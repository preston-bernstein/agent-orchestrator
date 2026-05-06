import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
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

describe("approval/formatApprovalArtifacts churn and response guidance", () => {
  it("top churn table caps at 20 rows and adds ellipsis hint when more files", () => {
    mkdirTmp();
    const plan = mkPlan([{ id: "t", spec_slug: "s", repo: "spring-api", supervisor: "spring", title: "t", paths: ["**"], depends_on: [] }]);
    const parts: string[] = [];
    for (let i = 0; i < 25; i++) {
      const f = `src/F${i}.java`;
      parts.push(`diff --git a/${f} b/${f}\n+++ b/${f}\n${"+l\n".repeat(i + 1)}`);
    }
    const mdPath = formatApprovalArtifacts({
      runId: "run-6",
      runDir: tmp,
      supervisorId: "spring",
      diffText: parts.join("\n"),
      reviewer: reviewerPass(),
      plan,
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    const tableRows = md.split("\n").filter((l) => l.startsWith("| src/F"));
    expect(tableRows.length).toBe(20);
    expect(md).toContain("more files; see pending.diff");
  });

  it("How to respond lists inspect path w/ pending.diff", () => {
    mkdirTmp();
    const mdPath = formatApprovalArtifacts({
      runId: "run-7",
      runDir: tmp,
      supervisorId: "spring",
      diffText: "diff --git a/a b/a\n+++ b/a\n",
      reviewer: reviewerPass(),
      plan: mkPlan([{ id: "t", spec_slug: "s", repo: "spring-api", supervisor: "spring", title: "t", paths: ["**"], depends_on: [] }]),
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("git apply --check");
    expect(md).toContain(path.join(tmp, "spring", "pending.diff"));
  });
});
