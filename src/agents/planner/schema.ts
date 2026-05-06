import { z } from "zod";

const PlannerStatus = z.enum([
  "ready",
  "needs_human_clarify",
  "skipped_no_change_needed",
  "refused",
]);

const PlannerRepo = z.enum([
  "spring-api",
  "react-ui",
  "agent-orchestrator",
]);

const PlannerSupervisor = z.enum(["spring", "react", "orch"]);

const PlannerTask = z.object({
  id: z.string(),
  spec_slug: z.string(),
  repo: PlannerRepo,
  supervisor: PlannerSupervisor,
  title: z.string().max(120),
  paths: z.array(z.string()),
  depends_on: z.array(z.string()).default([]),
  contract_artifact: z.string().optional(),
  consumes_contract: z.string().optional(),
});
export type PlannerTaskT = z.infer<typeof PlannerTask>;

export const PlannerOutput = z.object({
  status: PlannerStatus,
  rationale: z.string().max(200),
  tasks: z.array(PlannerTask).max(20),
  path_ownership_map: z.record(z.string(), z.array(z.string())),
  refusals: z.array(z.string()),
});
export type PlannerOutputT = z.infer<typeof PlannerOutput>;
