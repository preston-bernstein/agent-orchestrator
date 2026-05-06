import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { verifyChain } from "../audit/verify.js";
import { mergeRollupRow } from "./rollupRow.js";
import type {
  ApprovalDecisionScan,
  NamedCounters,
  PerRunRollup,
  RollupAccum,
  ScenarioId,
  ScorecardModel,
  TotalsAccum,
  TotalsRollup,
} from "./types.js";
export type { ScorecardModel } from "./types.js";

function emptyNamed(): NamedCounters {
  return { dry_plan_count: 0, o5_skip_count: 0, hitl_count: 0 };
}

/**
 * Paths to runs/<runId>/audit.jsonl under `runsDir` (non-recursive).
 * Skips dot dirs and dirs starting with `_` (tests / scratch).
 */
export function discoverAuditPaths(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(runsDir)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("_")) continue;
    const sub = path.join(runsDir, name);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const audit = path.join(sub, "audit.jsonl");
    if (existsSync(audit)) out.push(path.resolve(audit));
  }
  return out.sort();
}


function parseRollupLines(auditPath: string, raw: string): RollupAccum {
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const acc: RollupAccum = {
    run_id: path.basename(path.dirname(auditPath)),
    named: emptyNamed(),
    counts_by_step: {},
    tokens_in_total: 0,
    tokens_out_total: 0,
    started_at: null,
    ended_at: null,
    decisionTokens: [],
    supervisorIds: [],
    supervisorDoneOutcomes: [],
    hasSupervisorBlocked: false,
    approvalPromptAtBySupervisor: {},
    approvalLatenciesMs: [],
    approvalApprovedCount: 0,
    approvalRejectedCount: 0,
    approvalTimeoutCount: 0,
  };

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    mergeRollupRow(acc, row);
    applyApprovalSignals(acc, row);
  }

  return acc;
}

function parseDecisionTokens(row: Record<string, unknown>): string[] {
  const d = row.decisions;
  if (!Array.isArray(d)) return [];
  return d.filter((x): x is string => typeof x === "string");
}

function parseApprovalDecisionFromTokens(tokens: readonly string[]): ApprovalDecisionScan {
  const out: ApprovalDecisionScan = { timeout: false };
  for (const t of tokens) {
    if (t === "decision=timeout") out.timeout = true;
    else if (t.startsWith("supervisor=")) out.supervisor = t.slice("supervisor=".length);
    else if (t.startsWith("approved=")) out.approved = t.slice("approved=".length) === "true";
  }
  return out;
}

function toEpochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function applyApprovalSignals(acc: RollupAccum, row: Record<string, unknown>): void {
  const step = typeof row.step === "string" ? row.step : "";
  const ts = typeof row.timestamp === "string" ? row.timestamp : undefined;
  const tokens = parseDecisionTokens(row);
  if (step === "approval_prompt_written") return recordApprovalPrompt(acc, tokens, ts);
  if (step !== "approval_decision") return;
  applyApprovalDecision(acc, tokens, ts);
}

function recordApprovalPrompt(
  acc: RollupAccum,
  tokens: readonly string[],
  timestamp: string | undefined,
): void {
  const sup = tokens.find((t) => t.startsWith("supervisor="))?.slice("supervisor=".length);
  if (sup && timestamp) acc.approvalPromptAtBySupervisor[sup] = timestamp;
}

function addApprovalDecisionCounter(acc: RollupAccum, d: ApprovalDecisionScan): void {
  if (d.timeout) acc.approvalTimeoutCount += 1;
  else if (d.approved === true) acc.approvalApprovedCount += 1;
  else if (d.approved === false) acc.approvalRejectedCount += 1;
}

function recordApprovalLatency(
  acc: RollupAccum,
  d: ApprovalDecisionScan,
  timestamp: string | undefined,
): void {
  const startIso = d.supervisor ? acc.approvalPromptAtBySupervisor[d.supervisor] : undefined;
  const start = toEpochMs(startIso);
  const end = toEpochMs(timestamp);
  if (start !== null && end !== null && end >= start) acc.approvalLatenciesMs.push(end - start);
}

function applyApprovalDecision(
  acc: RollupAccum,
  tokens: readonly string[],
  timestamp: string | undefined,
): void {
  const d = parseApprovalDecisionFromTokens(tokens);
  addApprovalDecisionCounter(acc, d);
  recordApprovalLatency(acc, d, timestamp);
}

/**
 * Classify a run into one of the demo scenarios A–E.
 *
 * Order:
 *   1. Explicit `scenario=X` decision token (test or CLI override).
 *   2. `planner_skipped` ⇒ E (refactor no-op, vault Demo Scorecard).
 *   3. `integration_run` + ≥2 `supervisor_spawn` ⇒ C (cross-repo contract).
 *   4. Single `supervisor_spawn`, supervisor=react ⇒ B (UI-only).
 *   5. Single `supervisor_spawn`, supervisor=spring ⇒ A (API single-stack).
 *   6. else `unknown`.
 *
 * Scenario A and Scenario D have identical audit shapes (single spring
 * supervisor, no contract); D requires the explicit tag.
 */
function scenarioTagFromDecisionTokens(tokens: readonly string[]): ScenarioId | undefined {
  for (const tok of tokens) {
    const m = /^scenario=([A-E])$/.exec(tok);
    if (m?.[1]) return m[1] as ScenarioId;
  }
  return undefined;
}

function scenarioFromStructuralCounts(acc: RollupAccum): ScenarioId {
  if ((acc.counts_by_step.planner_skipped ?? 0) > 0) return "E";
  const supervisorSpawns = acc.counts_by_step.supervisor_spawn ?? 0;
  const integrationRuns = acc.counts_by_step.integration_run ?? 0;
  if (supervisorSpawns >= 2 && integrationRuns >= 1) return "C";
  if (supervisorSpawns !== 1) return "unknown";
  const id = acc.supervisorIds[0];
  if (id === "react") return "B";
  if (id === "spring") return "A";
  return "unknown";
}

function inferScenario(acc: RollupAccum): ScenarioId {
  const tag = scenarioTagFromDecisionTokens(acc.decisionTokens);
  return tag ?? scenarioFromStructuralCounts(acc);
}

/**
 * Per-run greenness for O7. A run is green iff:
 *   - audit chain valid (set by caller),
 *   - all `supervisor_done` outcomes report `status=done`,
 *   - no `supervisor_blocked` event,
 *   - at least one supervisor was spawned OR the run was a planner_skipped no-op (E).
 *
 * Phase 8/9 — best-effort over current audit shape; scorecard surfaces this
 * for vault Demo Scorecard's "≥80% scenarios green" bar.
 */
function inferGreen(acc: RollupAccum, chainValid: boolean): boolean {
  if (!chainValid) return false;
  if (acc.hasSupervisorBlocked) return false;
  const skipped = (acc.counts_by_step.planner_skipped ?? 0) > 0;
  const spawns = acc.counts_by_step.supervisor_spawn ?? 0;
  if (!skipped && spawns === 0) return false;
  if (acc.supervisorDoneOutcomes.length === 0 && skipped) return true;
  return acc.supervisorDoneOutcomes.every((s) => s === "done");
}

/**
 * Fix-loop count for O7 `avg_fix_loops`. A clean first-pass run records
 * exactly one `gate_invocation` per supervised task; each fix loop adds one
 * additional invocation. Counted = `gate_invocation_count - supervisor_done_count`
 * (clamped at 0).
 */
function inferFixLoops(acc: RollupAccum): number {
  const gates = acc.counts_by_step.gate_invocation ?? 0;
  const dones = acc.counts_by_step.supervisor_done ?? 0;
  return Math.max(0, gates - dones);
}

function avgMs(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const total = xs.reduce((a, b) => a + b, 0);
  return Math.round((total / xs.length) * 100) / 100;
}

export function rollupAuditJsonl(auditPath: string): PerRunRollup {
  let raw: string;
  try {
    raw = readFileSync(auditPath, "utf8");
  } catch {
    raw = "";
  }

  const v = verifyChain(auditPath);
  const acc = parseRollupLines(auditPath, raw);
  const chain_valid = v.valid;
  const chain_error =
    !v.valid ? `${v.reason} (record ${v.brokenAt})` : undefined;
  const lines = raw.split("\n").filter((l) => l.length > 0);

  return {
    audit_path: path.resolve(auditPath),
    chain_valid,
    chain_error,
    run_id: acc.run_id,
    ...acc.named,
    record_count: lines.length,
    counts_by_step: acc.counts_by_step,
    tokens_in_total: acc.tokens_in_total,
    tokens_out_total: acc.tokens_out_total,
    started_at: acc.started_at,
    ended_at: acc.ended_at,
    scenario: inferScenario(acc),
    green: inferGreen(acc, chain_valid),
    fix_loops: inferFixLoops(acc),
    approval_approved_count: acc.approvalApprovedCount,
    approval_rejected_count: acc.approvalRejectedCount,
    approval_timeout_count: acc.approvalTimeoutCount,
    approval_latency_ms_avg: avgMs(acc.approvalLatenciesMs),
  };
}

function mergeTotalsMergedSteps(
  totals: Record<string, number>,
  per: Record<string, number>,
): void {
  for (const [k, n] of Object.entries(per)) {
    totals[k] = (totals[k] ?? 0) + n;
  }
}

function newTotalsAccum(): TotalsAccum {
  return {
    counts_by_step: {},
    named: emptyNamed(),
    record_count: 0,
    tokens_in_total: 0,
    tokens_out_total: 0,
    chain_breaks: 0,
    green_count: 0,
    fix_loops_total: 0,
    approval_approved_count: 0,
    approval_rejected_count: 0,
    approval_timeout_count: 0,
    approval_latency_ms_total: 0,
    approval_latency_ms_n: 0,
    scenarios_seen: { A: 0, B: 0, C: 0, D: 0, E: 0, unknown: 0 },
  };
}

function applyRunToTotals(acc: TotalsAccum, r: PerRunRollup): void {
  acc.record_count += r.record_count;
  acc.tokens_in_total += r.tokens_in_total;
  acc.tokens_out_total += r.tokens_out_total;
  acc.named.dry_plan_count += r.dry_plan_count;
  acc.named.o5_skip_count += r.o5_skip_count;
  acc.named.hitl_count += r.hitl_count;
  mergeTotalsMergedSteps(acc.counts_by_step, r.counts_by_step);
  if (!r.chain_valid) acc.chain_breaks += 1;
  if (r.green) acc.green_count += 1;
  acc.fix_loops_total += r.fix_loops;
  acc.approval_approved_count += r.approval_approved_count;
  acc.approval_rejected_count += r.approval_rejected_count;
  acc.approval_timeout_count += r.approval_timeout_count;
  const decisionCount =
    r.approval_approved_count + r.approval_rejected_count + r.approval_timeout_count || 1;
  if (typeof r.approval_latency_ms_avg === "number") {
    acc.approval_latency_ms_total += r.approval_latency_ms_avg * decisionCount;
    acc.approval_latency_ms_n += decisionCount;
  }
  acc.scenarios_seen[r.scenario] += 1;
}

export function accumulateTotals(runs: PerRunRollup[]): TotalsRollup {
  const acc = newTotalsAccum();
  for (const r of runs) applyRunToTotals(acc, r);

  const runs_scanned = runs.length;
  const green_pct =
    runs_scanned === 0 ? 0 : Math.round((acc.green_count / runs_scanned) * 1000) / 10;
  const avg_fix_loops =
    runs_scanned === 0 ? 0 : Math.round((acc.fix_loops_total / runs_scanned) * 100) / 100;
  // O7: green_pct >= 80 AND avg_fix_loops <= 1.5 AND chain_breaks == 0.
  // Require at least one scanned run to avoid trivial-true on empty runs dir.
  const phase_2_eligible =
    runs_scanned > 0 &&
    green_pct >= 80 &&
    avg_fix_loops <= 1.5 &&
    acc.chain_breaks === 0;
  const approval_latency_ms_avg =
    acc.approval_latency_ms_n === 0
      ? null
      : Math.round((acc.approval_latency_ms_total / acc.approval_latency_ms_n) * 100) / 100;

  return {
    runs_scanned,
    record_count: acc.record_count,
    tokens_in_total: acc.tokens_in_total,
    tokens_out_total: acc.tokens_out_total,
    chain_breaks: acc.chain_breaks,
    counts_by_step: acc.counts_by_step,
    ...acc.named,
    green_count: acc.green_count,
    green_pct,
    avg_fix_loops,
    scenarios_seen: acc.scenarios_seen,
    phase_2_eligible,
    approval_approved_count: acc.approval_approved_count,
    approval_rejected_count: acc.approval_rejected_count,
    approval_timeout_count: acc.approval_timeout_count,
    approval_latency_ms_avg,
  };
}

/** Inclusive UTC day start for `YYYY-MM-DD` */
export function sinceIsoUtc(sinceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    throw new Error(`--since expects YYYY-MM-DD, got ${sinceDate}`);
  }
  return `${sinceDate}T00:00:00.000Z`;
}

export function filterRunsSince(runs: PerRunRollup[], sinceIso: string): PerRunRollup[] {
  return runs.filter((r) => {
    if (!r.ended_at) return true;
    return r.ended_at >= sinceIso;
  });
}

export function buildScorecardModel(
  runsDir: string,
  auditPaths?: string[],
): ScorecardModel {
  const resolved = path.resolve(runsDir);
  const paths = auditPaths ?? discoverAuditPaths(resolved);
  const runs = paths.map((p) => rollupAuditJsonl(p));
  const totals = accumulateTotals(runs);
  return {
    runs_dir: resolved,
    generated_at: new Date().toISOString(),
    runs,
    totals,
  };
}
