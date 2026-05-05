import { z } from "zod";

/** Vault `Build/Prompts/reviewer.md` §Output (O1). Phase 7 MVP = deterministic slice only. */
const ReviewerFindingSeverity = z.enum(["error", "warning", "info"]);

const ReviewerFinding = z.object({
  severity: ReviewerFindingSeverity,
  rule: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string().max(160),
});

const ReviewerGateSummary = z.object({
  fast: z.enum(["pass", "fail", "skipped"]),
  heavy: z.enum(["pass", "fail", "skipped"]),
  coverage_pct: z.number().optional(),
  coverage_floor: z.number().optional(),
  mutation_score: z.number().optional(),
  mutation_floor: z.number().optional(),
});

export const ReviewerOutput = z.object({
  status: z.enum(["pass", "fail", "pass_with_warnings"]),
  rationale: z.string().max(200),
  findings: z.array(ReviewerFinding),
  gate_summary: ReviewerGateSummary,
});

export type ReviewerOutputT = z.infer<typeof ReviewerOutput>;
export type ReviewerFindingT = z.infer<typeof ReviewerFinding>;
