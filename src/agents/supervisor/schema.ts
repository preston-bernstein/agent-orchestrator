import { z } from "zod";

const SupervisorStatus = z.enum([
  "done",
  "fix_loop",
  "block_for_contract",
  "needs_human_clarify",
  "budget_exhausted",
]);

const SupervisorTaskState = z.enum([
  "green",
  "red",
  "in_progress",
  "skipped",
]);

const SupervisorNextAction = z.enum([
  "hand_off_to_reviewer",
  "spawn_fix_subagent",
  "wait_for_contract",
  "halt",
]);

const SupervisorTaskResult = z.object({
  task_id: z.string(),
  state: SupervisorTaskState,
  fix_loop_count: z.number(),
  notes: z.string().max(120),
});

const SupervisorFixTarget = z.object({
  task_id: z.string(),
  failing_gate: z.string(),
  log_excerpt: z.string().max(800),
});

const _SupervisorOutputSchema = z.object({
  status: SupervisorStatus,
  rationale: z.string().max(200),
  pending_diff_path: z.string().optional(),
  task_results: z.array(SupervisorTaskResult),
  next_action: SupervisorNextAction,
  fix_targets: z.array(SupervisorFixTarget).default([]),
});
export type SupervisorOutputT = z.infer<typeof _SupervisorOutputSchema>;
export type SupervisorTaskResultT = z.infer<typeof SupervisorTaskResult>;
export type SupervisorFixTargetT = z.infer<typeof SupervisorFixTarget>;
