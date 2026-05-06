import type { AuditWriter } from "../audit/jsonl.js";
import { CliArgError } from "../errors/CliArgError.js";

/** Playbook §Human in the loop — C1–C5 ids. */
type HitlCategory = "C1" | "C2" | "C3" | "C4" | "C5";

type HitlSignal =
  | { kind: "danger_apply" }
  | { kind: "first_live_tf" }
  | { kind: "restricted_path_touch"; paths: readonly string[] };

interface HitlClassification {
  hitl_category: HitlCategory;
  requires_approval: boolean;
}

/**
 * Maps workflow signals → HITL category (vault SF5 / Playbook C1–C5).
 * Expand with C2/C5 as reviewer + planner ambiguity paths land.
 */
export function classifyHitl(signal: HitlSignal): HitlClassification {
  switch (signal.kind) {
    case "danger_apply":
      return { hitl_category: "C1", requires_approval: true };
    case "first_live_tf":
      return { hitl_category: "C4", requires_approval: true };
    case "restricted_path_touch":
      return { hitl_category: "C3", requires_approval: true };
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

interface AuditHitlEscalationInput {
  signal: HitlSignal;
  /** CLI `--reason` when `signal.kind === danger_apply` (already validated non-empty). */
  danger_reason?: string;
  /** Optional freeform note (e.g. first path in list). */
  note?: string;
}

const REASON_AUDIT_MAX = 200;

function signalLabel(signal: HitlSignal): string {
  switch (signal.kind) {
    case "danger_apply":
      return "danger_apply";
    case "first_live_tf":
      return "first_live_tf";
    case "restricted_path_touch":
      return `restricted_path_touch:${signal.paths.length}`;
    default: {
      const _e: never = signal;
      return _e;
    }
  }
}

/**
 * Append `hitl_escalation` to the audit chain (SF5 task 31).
 */
export function auditHitlEscalation(
  writer: AuditWriter,
  runId: string,
  input: AuditHitlEscalationInput,
): void {
  const { hitl_category, requires_approval } = classifyHitl(input.signal);
  const decisions = [
    `hitl_category=${hitl_category}`,
    `signal=${signalLabel(input.signal)}`,
    `requires_approval=${requires_approval}`,
  ];
  if (input.note) decisions.push(`note=${input.note.slice(0, REASON_AUDIT_MAX)}`);
  if (input.danger_reason) {
    decisions.push(
      `reason=${input.danger_reason.slice(0, REASON_AUDIT_MAX)}`,
    );
  }
  writer.write({
    run_id: runId,
    step: "hitl_escalation",
    agent: "policy",
    decisions,
    timestamp: new Date().toISOString(),
  });
}

/**
 * `--danger-apply` only on execute lane; must pair with non-empty `--reason` (task 32).
 */
export function assertDangerApplyPolicy(args: {
  execute: boolean;
  dryPlan: boolean;
  dangerApply: boolean;
  reason?: string;
}): void {
  if (!args.dangerApply) return;
  if (args.dryPlan) {
    throw new CliArgError("--danger-apply conflicts with dry-plan / ORCH_DRY_PLAN");
  }
  if (!args.execute) {
    throw new CliArgError("--danger-apply requires --execute");
  }
  const r = args.reason?.trim() ?? "";
  if (!r) {
    throw new CliArgError("--danger-apply requires --reason <non-empty string>");
  }
}
