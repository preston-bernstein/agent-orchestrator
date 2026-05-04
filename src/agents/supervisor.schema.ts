import { z } from "zod";

/**
 * Supervisor output schema (O1 — structured outputs).
 *
 * Vault canon: `Build/Prompts/supervisor-base.md` §Output. Spring + React
 * supervisors share this shape; stack overlay specializes prompts only.
 *
 * Status semantics:
 *  - `done`: all in-flight tasks green; `pending_diff_path` set; Approval
 *    node owns next step (G4).
 *  - `fix_loop`: one or more tasks failed gate; `fix_targets` populated;
 *    supervisor will re-spawn fix-subagent up to `max_fix_loops` (edge 10).
 *  - `block_for_contract`: upstream contract artifact not yet published
 *    (edge 1); halt until producer supervisor publishes.
 *  - `needs_human_clarify`: ambiguity / overlap / persistent empty patch;
 *    HITL required (C2).
 *  - `budget_exhausted`: O3 cap hit; halt this branch only (other
 *    supervisors continue).
 */
export const SupervisorStatus = z.enum([
  "done",
  "fix_loop",
  "block_for_contract",
  "needs_human_clarify",
  "budget_exhausted",
]);

export const SupervisorTaskState = z.enum([
  "green",
  "red",
  "in_progress",
  "skipped",
]);

export const SupervisorNextAction = z.enum([
  "hand_off_to_reviewer",
  "spawn_fix_subagent",
  "wait_for_contract",
  "halt",
]);

export const SupervisorTaskResult = z.object({
  task_id: z.string(),
  state: SupervisorTaskState,
  fix_loop_count: z.number(),
  notes: z.string().max(120),
});

export const SupervisorFixTarget = z.object({
  task_id: z.string(),
  failing_gate: z.string(),
  log_excerpt: z.string().max(800),
});

export const SupervisorOutput = z.object({
  status: SupervisorStatus,
  rationale: z.string().max(200),
  pending_diff_path: z.string().optional(),
  task_results: z.array(SupervisorTaskResult),
  next_action: SupervisorNextAction,
  fix_targets: z.array(SupervisorFixTarget).default([]),
});
export type SupervisorOutputT = z.infer<typeof SupervisorOutput>;
export type SupervisorTaskResultT = z.infer<typeof SupervisorTaskResult>;
export type SupervisorFixTargetT = z.infer<typeof SupervisorFixTarget>;
