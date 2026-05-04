import { z } from "zod";

/**
 * Subagent output schema (O1 — structured outputs).
 *
 * Vault canon: `Build/Prompts/subagent-base.md` §Output. Same shape is
 * reused by `fix-subagent` per `Build/Prompts/fix-subagent.md` ("Same
 * output shape as subagent-base").
 *
 * Rationale ≤200 chars (no chain-of-thought). `patch` is a unified diff
 * string (`''` when status ∈ {`no_change`, `refused`}). Supervisor merges
 * one task → one diff (no multi-patch returns).
 */
export const SubagentStatus = z.enum([
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
