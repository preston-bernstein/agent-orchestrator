import type { ManagedRepoMap } from "../config/managedRepos.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { GateInvocation } from "../gates/types.js";

export interface SupervisorReviewerSlice {
  supervisorId: string;
  stackId: string;
  diffText: string;
  gateHistory: readonly GateInvocation[];
  taskSummaries: readonly {
    task_id: string;
    title: string;
    state: string;
    fix_loop_count: number;
  }[];
}

/** Narrow integration verdict for reviewer (avoid importing workflow layer). */
export interface ReviewerIntegrationVerdict {
  ran: boolean;
  recommended_action?: string;
  status?: string;
}

export interface ReviewerDeterministicInput {
  plan: PlannerOutputT;
  supervisors: readonly SupervisorReviewerSlice[];
  repos: ManagedRepoMap;
  integration?: ReviewerIntegrationVerdict;
}
