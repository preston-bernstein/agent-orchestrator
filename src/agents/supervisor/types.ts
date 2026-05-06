import type { AssembledPrompt } from "../../llm/assemblePrompt.js";
import type { GateInvocation, RunQualityDeps } from "../../gates/types.js";

export interface SupervisorTaskResult {
  task_id: string;
  state: "green" | "red" | "in_progress" | "skipped";
  fix_loop_count: number;
  notes: string;
}

export interface SupervisorFixTarget {
  task_id: string;
  failing_gate: string;
  log_excerpt: string;
}

export interface SupervisorScratchForTasks {
  visited: string[];
  attemptCounter: Record<string, number>;
  tokensDelta: { supervisor: number; subagent: number; "fix-subagent": number };
  gateHistory: GateInvocation[];
  patches: { task_id: string; patch: string; attempt: number }[];
  taskResults: SupervisorTaskResult[];
  fixTargets: SupervisorFixTarget[];
  anyTaskBudgetCap: boolean;
  anyTaskHumanClarify: boolean;
}

export type SupervisorEstimateKind = "supervisor" | "subagent" | "fix-subagent";

export interface RunSupervisorDeps {
  subagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  fixSubagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  exec?: RunQualityDeps["exec"];
  estimateTokens?: (kind: SupervisorEstimateKind) => number;
  wrapSupervisorTaskRun?: (
    stepId: string,
    fn: () => Promise<void>,
  ) => Promise<void>;
  /** When set (Inngest), each `runQuality` gate runs inside `step.run(id, …)`. */
  wrapGateRun?: (
    stepId: string,
    fn: () => Promise<GateInvocation>,
  ) => Promise<GateInvocation>;
}
