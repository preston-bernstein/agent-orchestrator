import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { verifyChain } from "../audit/verify.js";

/** Named counters Phase 8 / vault Examples task 67 */
interface NamedCounters {
  dry_plan_count: number;
  o5_skip_count: number;
  hitl_count: number;
}

/** Demo scorecard scenario id (vault `Orchestration PoC Demo Scorecard.md`). */
type ScenarioId = "A" | "B" | "C" | "D" | "E" | "unknown";

/** Per-run derived flags Phase 9 / O7 numeric trigger. */
interface RunDerived {
  scenario: ScenarioId;
  /** Aggregate run-level greenness — `true` only if green supervisor outcome
   *  AND audit chain valid AND no `supervisor_blocked`. */
  green: boolean;
  /** Sum of fix-loop attempts per task (audit step `gate_invocation` minus
   *  number of supervisor groups — first gate invocation per supervisor is
   *  the initial run, each subsequent one is a fix loop). */
  fix_loops: number;
}

interface PerRunRollup extends NamedCounters, RunDerived {
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

interface TotalsRollup extends NamedCounters {
  runs_scanned: number;
  record_count: number;
  tokens_in_total: number;
  tokens_out_total: number;
  chain_breaks: number;
  counts_by_step: Record<string, number>;
  /** O7 numeric trigger fields (vault `Build/Patterns/O7-phase2-numeric-trigger.md`). */
  green_count: number;
  green_pct: number;
  avg_fix_loops: number;
  scenarios_seen: Record<ScenarioId, number>;
  /** `green_pct >= 80 AND avg_fix_loops <= 1.5 AND chain_breaks === 0` over the scanned runs. */
  phase_2_eligible: boolean;
}

export interface ScorecardModel {
  runs_dir: string;
  generated_at: string;
  runs: PerRunRollup[];
  totals: TotalsRollup;
}

function emptyNamed(): NamedCounters {
  return { dry_plan_count: 0, o5_skip_count: 0, hitl_count: 0 };
}

function bumpNamed(c: NamedCounters, step: string): void {
  if (step === "dry_plan") c.dry_plan_count += 1;
  else if (step === "planner_skipped") c.o5_skip_count += 1;
  else if (step === "hitl_escalation") c.hitl_count += 1;
}

function mergeStepCounts(into: Record<string, number>, step: string): void {
  into[step] = (into[step] ?? 0) + 1;
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

interface RollupAccum {
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
}

function parseDecisions(row: Record<string, unknown>): string[] {
  const d = row.decisions;
  if (!Array.isArray(d)) return [];
  return d.filter((x): x is string => typeof x === "string");
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
  };

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const step = typeof row.step === "string" ? row.step : "";
    if (!step) continue;
    mergeStepCounts(acc.counts_by_step, step);
    bumpNamed(acc.named, step);
    const ri = row.run_id;
    if (typeof ri === "string" && ri) acc.run_id = ri;
    const ts = row.timestamp;
    if (typeof ts === "string" && ts.length > 0) {
      if (acc.started_at === null || ts < acc.started_at) acc.started_at = ts;
      if (acc.ended_at === null || ts > acc.ended_at) acc.ended_at = ts;
    }
    const ti = row.tokens_in;
    const to = row.tokens_out;
    if (typeof ti === "number" && Number.isFinite(ti)) acc.tokens_in_total += ti;
    if (typeof to === "number" && Number.isFinite(to)) acc.tokens_out_total += to;

    const tokens = parseDecisions(row);
    acc.decisionTokens.push(...tokens);
    const agent = typeof row.agent === "string" ? row.agent : "";
    if (step === "supervisor_spawn") {
      // `supervisor_spawn` writes `agent: "${supId}-supervisor"` (vault canon
      // `Build/Playbook.md` §Phase 5; `src/workflows/supervisorBranch.ts`).
      const m = /^([a-z0-9-]+)-supervisor$/.exec(agent);
      if (m && m[1]) acc.supervisorIds.push(m[1]);
    }
    if (step === "supervisor_done") {
      const statusTok = tokens.find((t) => t.startsWith("status="));
      if (statusTok) {
        acc.supervisorDoneOutcomes.push(statusTok.slice("status=".length));
      }
    }
    if (step === "supervisor_blocked") acc.hasSupervisorBlocked = true;
  }

  return acc;
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
function inferScenario(acc: RollupAccum): ScenarioId {
  for (const tok of acc.decisionTokens) {
    const m = /^scenario=([A-E])$/.exec(tok);
    if (m && m[1]) return m[1] as ScenarioId;
  }
  if ((acc.counts_by_step.planner_skipped ?? 0) > 0) return "E";
  const supervisorSpawns = acc.counts_by_step.supervisor_spawn ?? 0;
  const integrationRuns = acc.counts_by_step.integration_run ?? 0;
  if (supervisorSpawns >= 2 && integrationRuns >= 1) return "C";
  if (supervisorSpawns === 1) {
    const id = acc.supervisorIds[0];
    if (id === "react") return "B";
    if (id === "spring") return "A";
  }
  return "unknown";
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

export function accumulateTotals(runs: PerRunRollup[]): TotalsRollup {
  const counts_by_step: Record<string, number> = {};
  const named = emptyNamed();
  let record_count = 0;
  let tokens_in_total = 0;
  let tokens_out_total = 0;
  let chain_breaks = 0;
  let green_count = 0;
  let fix_loops_total = 0;
  const scenarios_seen: Record<ScenarioId, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
    unknown: 0,
  };

  for (const r of runs) {
    record_count += r.record_count;
    tokens_in_total += r.tokens_in_total;
    tokens_out_total += r.tokens_out_total;
    named.dry_plan_count += r.dry_plan_count;
    named.o5_skip_count += r.o5_skip_count;
    named.hitl_count += r.hitl_count;
    mergeTotalsMergedSteps(counts_by_step, r.counts_by_step);
    if (!r.chain_valid) chain_breaks += 1;
    if (r.green) green_count += 1;
    fix_loops_total += r.fix_loops;
    scenarios_seen[r.scenario] += 1;
  }

  const runs_scanned = runs.length;
  const green_pct =
    runs_scanned === 0 ? 0 : Math.round((green_count / runs_scanned) * 1000) / 10;
  const avg_fix_loops =
    runs_scanned === 0 ? 0 : Math.round((fix_loops_total / runs_scanned) * 100) / 100;
  // O7: green_pct >= 80 AND avg_fix_loops <= 1.5 AND chain_breaks == 0.
  // Require at least one scanned run to avoid trivial-true on empty runs dir.
  const phase_2_eligible =
    runs_scanned > 0 &&
    green_pct >= 80 &&
    avg_fix_loops <= 1.5 &&
    chain_breaks === 0;

  return {
    runs_scanned,
    record_count,
    tokens_in_total,
    tokens_out_total,
    chain_breaks,
    counts_by_step,
    ...named,
    green_count,
    green_pct,
    avg_fix_loops,
    scenarios_seen,
    phase_2_eligible,
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
