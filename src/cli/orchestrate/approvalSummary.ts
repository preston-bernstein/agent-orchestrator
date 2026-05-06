import type { ApprovalOutcome } from "../../workflows/executeLane.js";

/** JSON-safe approval/reviewer summary slice for boot output. */
export function approvalSummarySlice(
  approval: ApprovalOutcome,
):
  | {
      kind: string;
      approval_prompt_paths?: string[];
      reviewer_findings?: number;
      skipped_reason?: string;
    }
  | undefined {
  switch (approval.kind) {
    case "skipped":
      return { kind: approval.kind, skipped_reason: approval.reason };
    case "reviewer_fail":
      return {
        kind: approval.kind,
        reviewer_findings: approval.reviewer.findings.length,
      };
    case "paused_for_approval":
      return {
        kind: approval.kind,
        approval_prompt_paths: [...approval.approval_prompt_paths],
      };
    case "cleared":
      return { kind: approval.kind };
    default: {
      const _e: never = approval;
      return _e;
    }
  }
}
