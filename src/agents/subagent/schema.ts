import { z } from "zod";

const SubagentStatus = z.enum([
  "patch",
  "no_change",
  "needs_more_context",
  "refused",
]);

export const SubagentOutput = z.object({
  status: SubagentStatus,
  rationale: z.string().max(200),
  patch: z.string(),
  files_touched: z.array(z.string()),
  refusals: z.array(z.string()).default([]),
  context_request: z.array(z.string()).default([]),
});
export type SubagentOutputT = z.infer<typeof SubagentOutput>;
