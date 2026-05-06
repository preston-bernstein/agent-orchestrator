import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import { ReviewerOutput } from "../../src/reviewer/schema.js";

export const approvalTmpDir = path.join(process.cwd(), "runs", "_test_approval_fmt");

export function mkPlan(tasks: PlannerOutputT["tasks"]): PlannerOutputT {
  return {
    status: "ready",
    rationale: "r",
    tasks,
    path_ownership_map: Object.fromEntries(tasks.map((t) => [t.id, t.paths])),
    refusals: [],
  };
}

export function reviewerPass(
  gate: { fast: string; heavy: string } = { fast: "pass", heavy: "skipped" },
) {
  return ReviewerOutput.parse({
    status: "pass",
    rationale: "ok",
    findings: [],
    gate_summary: gate,
  });
}

export function mkdirTmp() {
  mkdirSync(approvalTmpDir, { recursive: true });
}
