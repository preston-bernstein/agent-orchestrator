import { describe, expect, it } from "vitest";
import { runReviewerPhase2 } from "../../src/reviewer/phase2.js";
import type { ReviewerOutputT } from "../../src/reviewer/schema.js";
import type { SupervisorReviewerSlice } from "../../src/reviewer/deterministic.js";

const base: ReviewerOutputT = {
  status: "pass",
  rationale: "deterministic clean",
  findings: [],
  gate_summary: { fast: "pass", heavy: "skipped" },
};

const supervisors: SupervisorReviewerSlice[] = [
  {
    supervisorId: "spring",
    stackId: "java-spring",
    diffText: "diff --git a/a b/a\n+++ b/a\n+x\n",
    gateHistory: [],
    taskSummaries: [{ task_id: "t1", title: "x", state: "green", fix_loop_count: 0 }],
  },
];

describe("reviewer/phase2", () => {
  it("merges warning findings to pass_with_warnings", async () => {
    const out = await runReviewerPhase2(
      { supervisors, deterministic: base },
      async () => ({
        rationale: "phase2 warning",
        findings: [
          { severity: "warning", rule: "comments-only", message: "mostly comments" },
        ],
      }),
    );
    expect(out.status).toBe("pass_with_warnings");
    expect(out.findings).toHaveLength(1);
  });

  it("merges error findings to fail", async () => {
    const out = await runReviewerPhase2(
      { supervisors, deterministic: base },
      async () => ({
        rationale: "phase2 error",
        findings: [
          { severity: "error", rule: "behavior-without-test", message: "src changed no tests" },
        ],
      }),
    );
    expect(out.status).toBe("fail");
  });
});

