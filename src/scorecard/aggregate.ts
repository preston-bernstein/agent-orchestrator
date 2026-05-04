import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { verifyChain } from "../audit/verify.js";

/** Named counters Phase 8 / vault Examples task 67 */
export interface NamedCounters {
  dry_plan_count: number;
  o5_skip_count: number;
  hitl_count: number;
}

export interface PerRunRollup extends NamedCounters {
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

function parseRollupLines(
  auditPath: string,
  raw: string,
): Omit<PerRunRollup, "audit_path" | "chain_valid" | "chain_error"> {
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const counts_by_step: Record<string, number> = {};
  const named = emptyNamed();
  let tokens_in_total = 0;
  let tokens_out_total = 0;
  let run_id = path.basename(path.dirname(auditPath));
  let started_at: string | null = null;
  let ended_at: string | null = null;

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const step = typeof row.step === "string" ? row.step : "";
    if (!step) continue;
    mergeStepCounts(counts_by_step, step);
    bumpNamed(named, step);
    const ri = row.run_id;
    if (typeof ri === "string" && ri) run_id = ri;
    const ts = row.timestamp;
    if (typeof ts === "string" && ts.length > 0) {
      if (started_at === null || ts < started_at) started_at = ts;
      if (ended_at === null || ts > ended_at) ended_at = ts;
    }
    const ti = row.tokens_in;
    const to = row.tokens_out;
    if (typeof ti === "number" && Number.isFinite(ti)) tokens_in_total += ti;
    if (typeof to === "number" && Number.isFinite(to)) tokens_out_total += to;
  }

  return {
    run_id,
    ...named,
    record_count: lines.length,
    counts_by_step,
    tokens_in_total,
    tokens_out_total,
    started_at,
    ended_at,
  };
}

export function rollupAuditJsonl(auditPath: string): PerRunRollup {
  let raw: string;
  try {
    raw = readFileSync(auditPath, "utf8");
  } catch {
    raw = "";
  }

  const v = verifyChain(auditPath);
  const parsed = parseRollupLines(auditPath, raw);
  const chain_valid = v.valid;
  const chain_error =
    !v.valid ? `${v.reason} (record ${v.brokenAt})` : undefined;

  return {
    audit_path: path.resolve(auditPath),
    chain_valid,
    chain_error,
    ...parsed,
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

  for (const r of runs) {
    record_count += r.record_count;
    tokens_in_total += r.tokens_in_total;
    tokens_out_total += r.tokens_out_total;
    named.dry_plan_count += r.dry_plan_count;
    named.o5_skip_count += r.o5_skip_count;
    named.hitl_count += r.hitl_count;
    mergeTotalsMergedSteps(counts_by_step, r.counts_by_step);
    if (!r.chain_valid) chain_breaks += 1;
  }

  return {
    runs_scanned: runs.length,
    record_count,
    tokens_in_total,
    tokens_out_total,
    chain_breaks,
    counts_by_step,
    ...named,
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
