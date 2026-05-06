import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { ReviewerOutputT } from "../reviewer/schema.js";

export interface DecisionInput {
  runId: string;
  supervisor: string;
  approved: boolean;
  reason?: string;
  note?: string;
  runsDir?: string;
}

export interface FormatApprovalInput {
  runId: string;
  runDir: string;
  supervisorId: string;
  diffText: string;
  reviewer: ReviewerOutputT;
  plan: PlannerOutputT;
  integrationNote?: string;
}
