/** Named counters Phase 8 / vault Examples task 67 */
export interface NamedCounters {
  dry_plan_count: number;
  o5_skip_count: number;
  hitl_count: number;
}

/** Demo scorecard scenario id (vault `Orchestration PoC Demo Scorecard.md`). */
export type ScenarioId = "A" | "B" | "C" | "D" | "E" | "unknown";

/** Per-run derived flags for O7 numeric trigger. */
export interface RunDerived {
  scenario: ScenarioId;
  /** Aggregate run-level greenness — `true` only if green supervisor outcome
   *  AND audit chain valid AND no `supervisor_blocked`. */
  green: boolean;
  /** Sum of fix-loop attempts per task (audit step `gate_invocation` minus
   *  number of supervisor groups — first gate invocation per supervisor is
   *  the initial run, each subsequent one is a fix loop). */
  fix_loops: number;
  approval_approved_count: number;
  approval_rejected_count: number;
  approval_timeout_count: number;
  approval_latency_ms_avg: number | null;
}

export interface PerRunRollup extends NamedCounters, RunDerived {
  run_id: string;
  audit_path: string;
  chain_valid: boolean;
  chain_error?: string;
  record_count: number;
  counts_by_step: Record<string, number>;
  tokens_in_total: number;
  tokens_out_total: number;
  started_at: string | null;
  ended_at: string | null;
}

export interface TotalsRollup extends NamedCounters {
  runs_scanned: number;
  record_count: number;
  tokens_in_total: number;
  tokens_out_total: number;
  chain_breaks: number;
  counts_by_step: Record<string, number>;
  /** O7 numeric trigger fields. */
  green_count: number;
  green_pct: number;
  avg_fix_loops: number;
  scenarios_seen: Record<ScenarioId, number>;
  /** `green_pct >= 80 AND avg_fix_loops <= 1.5 AND chain_breaks === 0` over the scanned runs. */
  phase_2_eligible: boolean;
  approval_approved_count: number;
  approval_rejected_count: number;
  approval_timeout_count: number;
  approval_latency_ms_avg: number | null;
}

export interface ScorecardModel {
  runs_dir: string;
  generated_at: string;
  runs: PerRunRollup[];
  totals: TotalsRollup;
}

export interface RollupAccum {
  run_id: string;
  named: NamedCounters;
  counts_by_step: Record<string, number>;
  tokens_in_total: number;
  tokens_out_total: number;
  started_at: string | null;
  ended_at: string | null;
  /** Audit decision tokens — collected for scenario inference + diagnostics. */
  decisionTokens: string[];
  /** Supervisor ids spawned — collected from `supervisor_spawn` decisions. */
  supervisorIds: string[];
  /** Outcome decisions of `supervisor_done` events — to infer green / fix-loops. */
  supervisorDoneOutcomes: string[];
  hasSupervisorBlocked: boolean;
  approvalPromptAtBySupervisor: Record<string, string>;
  approvalLatenciesMs: number[];
  approvalApprovedCount: number;
  approvalRejectedCount: number;
  approvalTimeoutCount: number;
}

export interface ApprovalDecisionScan {
  supervisor?: string;
  approved?: boolean;
  timeout: boolean;
}

export interface TotalsAccum {
  counts_by_step: Record<string, number>;
  named: NamedCounters;
  record_count: number;
  tokens_in_total: number;
  tokens_out_total: number;
  chain_breaks: number;
  green_count: number;
  fix_loops_total: number;
  approval_approved_count: number;
  approval_rejected_count: number;
  approval_timeout_count: number;
  approval_latency_ms_total: number;
  approval_latency_ms_n: number;
  scenarios_seen: Record<ScenarioId, number>;
}
