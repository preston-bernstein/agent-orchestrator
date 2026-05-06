import path from "node:path";
import { AuditWriter } from "../../audit/jsonl.js";
import type { ParsedArgs } from "../args.js";
import type { BootSummary, ExecuteLaneResult } from "./types.js";
import {
  parseSupervisorFromPromptPath,
  pollAllSupervisorDecisions,
  readAuditTailHash,
} from "./approvalWaitHelpers.js";

function approvalTimeoutMs(args: ParsedArgs): number {
  if (args.approvalTimeoutMs !== undefined) return args.approvalTimeoutMs;
  const env = process.env.ORCH_APPROVAL_TIMEOUT_MS;
  if (!env) return 24 * 60 * 60 * 1000;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 24 * 60 * 60 * 1000;
}


function attachCountsToSummary(
  summary: BootSummary,
  counts: { approved: number; rejected: number; timedOut: number },
): void {
  if (!summary.execute?.approval) return;
  summary.execute.approval.approved_count = counts.approved;
  summary.execute.approval.rejected_count = counts.rejected;
  summary.execute.approval.timed_out_count = counts.timedOut;
}

/**
 * When execute lane paused for approval, optionally block until decisions.
 * @returns process exit hint: 0 ok, 1 rejected, 2 still waiting / timeout
 */
export async function maybeResolvePausedApproval(input: {
  summary: BootSummary;
  executeResult?: ExecuteLaneResult;
  args: ParsedArgs;
  runsDir: string;
}): Promise<number> {
  const { summary, executeResult, args, runsDir } = input;
  if (!executeResult) return 0;
  const approval = executeResult.approval;
  if (approval.kind !== "paused_for_approval") return 0;
  summary.outcome = "paused_for_approval";
  if (!args.waitApproval) return 2;

  const timeoutMs = approvalTimeoutMs(args);
  const supervisors = approval.approval_prompt_paths.map(parseSupervisorFromPromptPath);
  const auditPath = path.join(runsDir, summary.run_id, "audit.jsonl");
  const approvalAudit = new AuditWriter({
    path: auditPath,
    prevHash: readAuditTailHash(auditPath),
  });

  const counts = await pollAllSupervisorDecisions({
    runId: summary.run_id,
    supervisors,
    timeoutMs,
    runsDir,
    audit: approvalAudit,
  });
  attachCountsToSummary(summary, counts);

  if (counts.timedOut > 0) return 2;
  if (counts.rejected > 0) {
    summary.ok = false;
    summary.outcome = "approval_rejected";
    return 1;
  }
  if (summary.execute?.approval) summary.execute.approval.kind = "cleared_after_wait";
  summary.outcome = "execute_completed";
  return 0;
}
