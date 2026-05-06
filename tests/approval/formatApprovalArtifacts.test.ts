import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatApprovalArtifacts } from "../../src/approval/formatApprovalArtifacts.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";
import { ReviewerOutput, type ReviewerFindingT } from "../../src/reviewer/schema.js";

const tmp = path.join(process.cwd(), "runs", "_test_approval_fmt");

function mkPlan(tasks: PlannerOutputT["tasks"]): PlannerOutputT {
  return {
    status: "ready",
    rationale: "r",
    tasks,
    path_ownership_map: Object.fromEntries(tasks.map((t) => [t.id, t.paths])),
    refusals: [],
  };
}

function reviewerPass(
  gate: { fast: string; heavy: string } = { fast: "pass", heavy: "skipped" },
) {
  return ReviewerOutput.parse({
    status: "pass",
    rationale: "ok",
    findings: [],
    gate_summary: gate,
  });
}

function mkdirTmp() {
  mkdirSync(tmp, { recursive: true });
}

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

  it("omits integration_note in payload when not passed; md uses n/a line", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "spring-T1",
        spec_slug: "feat",
        repo: "spring-api",
        supervisor: "spring",
        title: "t1",
        paths: ["src/**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
    const { jsonPath, payload } = formatApprovalArtifacts({
      runId: "run-2",
      runDir: tmp,
      supervisorId: "spring",
      diffText: "diff --git a/a b/a\n+++ b/a\n",
      reviewer,
      plan,
    });
    expect("integration_note" in payload).toBe(false);
    expect(readFileSync(jsonPath, "utf8")).not.toContain("integration_note");
    const md = readFileSync(path.join(tmp, "spring", "approval-prompt.md"), "utf8");
    expect(md).toContain("- _(n/a or skipped)_");
  });

  it("filters + sorts findings: in-diff only; error before warning; file order", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "spring-T1",
        spec_slug: "s",
        repo: "spring-api",
        supervisor: "spring",
        title: "t",
        paths: ["src/**"],
        depends_on: [],
      },
    ]);
    const reviewer = ReviewerOutput.parse({
      status: "pass_with_warnings",
      rationale: "w",
      findings: [
        {
          severity: "warning",
          rule: "w1",
          file: "src/B.java",
          line: 9,
          message: "b",
        },
        {
          severity: "error",
          rule: "e1",
          file: "src/A.java",
          line: 3,
          message: "a",
        },
        {
          severity: "info",
          rule: "orphan",
          file: "other/C.java",
          line: 1,
          message: "c",
        },
        { severity: "info", rule: "global", message: "no file" },
      ],
      gate_summary: { fast: "pass", heavy: "fail" },
    });
    const diffText = [
      "diff --git a/src/A.java b/src/A.java\n+++ b/src/A.java\n+x\n",
      "diff --git a/src/B.java b/src/B.java\n+++ b/src/B.java\n+y\n",
    ].join("\n");
    const { payload, mdPath } = formatApprovalArtifacts({
      runId: "run-3",
      runDir: tmp,
      supervisorId: "spring",
      diffText,
      reviewer,
      plan,
    });
    const outFindings = payload.findings as ReviewerFindingT[];
    expect(outFindings).toHaveLength(3);
    expect(outFindings[0]!.severity).toBe("error");
    expect(outFindings[1]!.severity).toBe("warning");
    expect(outFindings[2]!.rule).toBe("global");
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("error · e1 · src/A.java:3");
    expect(md).toContain("warning · w1 · src/B.java:9");
    expect(md).toContain("info · global ·");
    expect(md).toContain("- Fast: pass");
    expect(md).toContain("- Heavy: fail");
  });

  it("dedupes spec_slugs and only lists tasks for this supervisor", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "a1",
        spec_slug: "x",
        repo: "spring-api",
        supervisor: "spring",
        title: "ta",
        paths: ["**"],
        depends_on: [],
      },
      {
        id: "a2",
        spec_slug: "x",
        repo: "spring-api",
        supervisor: "spring",
        title: "tb",
        paths: ["**"],
        depends_on: [],
      },
      {
        id: "other",
        spec_slug: "y",
        repo: "react-ui",
        supervisor: "react",
        title: "skip",
        paths: ["**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
    const { payload, mdPath } = formatApprovalArtifacts({
      runId: "run-4",
      runDir: tmp,
      supervisorId: "spring",
      diffText: "diff --git a/z b/z\n+++ b/z\n+z\n",
      reviewer,
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
    const plan = mkPlan([]);
    const reviewer = reviewerPass({ fast: "skipped", heavy: "skipped" });
    const mdPath = formatApprovalArtifacts({
      runId: "run-5",
      runDir: tmp,
      supervisorId: "solo",
      diffText: "",
      reviewer,
      plan,
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("- _(no tasks)_");
    expect(md).toMatch(/Spec: `\?`/);
  });

  it("top churn table caps at 20 rows and adds ellipsis hint when more files", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "t",
        spec_slug: "s",
        repo: "spring-api",
        supervisor: "spring",
        title: "t",
        paths: ["**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
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
      reviewer,
      plan,
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    const tableRows = md.split("\n").filter((l) => l.startsWith("| src/F"));
    expect(tableRows.length).toBe(20);
    expect(md).toContain("more files; see pending.diff");
  });

  it("How to respond lists inspect path w/ pending.diff", () => {
    mkdirTmp();
    const plan = mkPlan([
      {
        id: "t",
        spec_slug: "s",
        repo: "spring-api",
        supervisor: "spring",
        title: "t",
        paths: ["**"],
        depends_on: [],
      },
    ]);
    const reviewer = reviewerPass();
    const mdPath = formatApprovalArtifacts({
      runId: "run-7",
      runDir: tmp,
      supervisorId: "spring",
      diffText: "diff --git a/a b/a\n+++ b/a\n",
      reviewer,
      plan,
    }).mdPath;
    const md = readFileSync(mdPath, "utf8");
    expect(md).toContain("git apply --check");
    expect(md).toContain(path.join(tmp, "spring", "pending.diff"));
  });
});
