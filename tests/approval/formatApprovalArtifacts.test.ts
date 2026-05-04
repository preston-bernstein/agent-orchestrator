import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatApprovalArtifacts } from "../../src/approval/formatApprovalArtifacts.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";
import { ReviewerOutput } from "../../src/reviewer/schema.js";

const tmp = path.join(process.cwd(), "runs", "_test_approval_fmt");

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("approval/formatApprovalArtifacts", () => {
  it("writes md + json w/ diff_hash", () => {
    mkdirSync(tmp, { recursive: true });
    const plan: PlannerOutputT = {
      status: "ready",
      rationale: "r",
      tasks: [
        {
          id: "spring-T1",
          spec_slug: "feat",
          repo: "spring-api",
          supervisor: "spring",
          title: "task",
          paths: ["src/**"],
          depends_on: [],
        },
      ],
      path_ownership_map: { "spring-T1": ["src/**"] },
      refusals: [],
    };
    const reviewer = ReviewerOutput.parse({
      status: "pass",
      rationale: "ok",
      findings: [],
      gate_summary: { fast: "pass", heavy: "skipped" },
    });
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
  });
});
