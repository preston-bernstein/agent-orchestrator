import { z } from "zod";

export const ApprovalPayloadSchema = z.object({
  run_id: z.string(),
  supervisor: z.string(),
  diff_hash: z.string(),
  reviewer_status: z.string(),
  findings: z.array(z.unknown()),
  gate_summary: z.record(z.unknown()),
  integration_note: z.string().optional(),
  spec_slugs: z.array(z.string()),
  pending_diff_rel: z.string(),
  written_at: z.string(),
});
export type ApprovalPayloadT = z.infer<typeof ApprovalPayloadSchema>;
