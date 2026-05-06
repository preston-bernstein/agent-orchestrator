import { createHash } from "node:crypto";
import path from "node:path";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { ReviewerFindingT } from "../reviewer/schema.js";
import type { FormatApprovalInput } from "./types.js";
import { ApprovalPayloadSchema, type ApprovalPayloadT } from "./payload.schema.js";
import { diffChurnByFile } from "../reviewer/diffPaths.js";

export type { ApprovalPayloadT };

function findingSeverityRank(s: string): number {
  if (s === "error") return 0;
  if (s === "warning") return 1;
  return 2;
}

export function filterFindingsForSupervisor(
  findings: readonly ReviewerFindingT[],
  diffFiles: readonly string[],
): ReviewerFindingT[] {
  const set = new Set(diffFiles);
  const mine = findings.filter((f) => !f.file || set.has(f.file));
  return [...mine].sort((a, b) => {
    const severityDelta = findingSeverityRank(a.severity) - findingSeverityRank(b.severity);
    if (severityDelta !== 0) return severityDelta;
    return (a.file ?? "").localeCompare(b.file ?? "");
  });
}

export function buildApprovalPayload(
  input: FormatApprovalInput,
  findings: ReviewerFindingT[],
  specSlugs: string[],
): ApprovalPayloadT {
  const pendingRel = path.join(input.supervisorId, "pending.diff");
  const diffHash = createHash("sha256").update(input.diffText, "utf8").digest("hex");
  return ApprovalPayloadSchema.parse({
    run_id: input.runId,
    supervisor: input.supervisorId,
    diff_hash: diffHash,
    reviewer_status: input.reviewer.status,
    findings,
    gate_summary: input.reviewer.gate_summary,
    ...(input.integrationNote !== undefined ? { integration_note: input.integrationNote } : {}),
    spec_slugs: specSlugs,
    pending_diff_rel: pendingRel.replace(/\\/g, "/"),
    written_at: new Date().toISOString(),
  });
}

export function deriveApprovalSlices(input: FormatApprovalInput): {
  tasks: PlannerOutputT["tasks"];
  specSlugs: string[];
  churn: ReturnType<typeof diffChurnByFile>;
  diffFiles: string[];
} {
  const tasks = input.plan.tasks.filter((t) => t.supervisor === input.supervisorId);
  const specSlugs = [...new Set(tasks.map((t) => t.spec_slug))];
  const churn = diffChurnByFile(input.diffText);
  const diffFiles = [...new Set(churn.map((c) => c.file))];
  return { tasks, specSlugs, churn, diffFiles };
}
