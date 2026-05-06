import type { ApprovalOutcome } from "../../workflows/executeLane.js";
import type { approvalSummarySlice } from "./approvalSummary.js";

export type ExecuteLaneResult = {
  aggregateStatus: string;
  supervisors: readonly { supervisorId: string; result: { output: { status: string } } }[];
  integration:
    | { ran: false; reason: string }
    | { ran: true; output: { status: string; recommended_action: string } };
  approval: ApprovalOutcome;
};

export interface BootSummary {
  ok: boolean;
  run_id: string;
  outcome:
    | "skipped"
    | "dry_plan"
    | "gates_verify"
    | "execution_started"
    | "execute_completed"
    | "paused_for_approval"
    | "approval_rejected"
    | "reviewer_failed"
    | "boot_only";
  expectations_snapshot: {
    doc_sha256: string | null;
    vault_git_sha: string | null;
  };
  cli_flags: {
    dry_plan: boolean;
    execute: boolean;
    gates_verify?: boolean;
    spec?: string;
    danger_apply?: boolean;
    follow?: boolean;
  };
  /** Hono artifact viewer (+ audit JSON sibling). Override with ORCH_ARTIFACT_BASE_URL. */
  artifact_base_url?: string;
  /** GET JSONL-derived audit timeline for this run. */
  audit_url?: string;
  /** Repo-relative `./runs/<id>/` scratch dir. */
  runs_dir_relative?: string;
  inngest_run_url?: string;
  event_id?: string;
  tf_probe: { skipped: true } | { skipped: false; status: number; models: number };
  plan_path?: string;
  reason?: string;
  execute?: {
    aggregateStatus: string;
    supervisors: { id: string; status: string }[];
    integration:
      | { ran: false; reason: string }
      | { ran: true; status: string; recommended: string };
    approval?: ReturnType<typeof approvalSummarySlice> & {
      approved_count?: number;
      rejected_count?: number;
      timed_out_count?: number;
      reviewer_findings?: number;
      skipped_reason?: string;
    };
  };
}
