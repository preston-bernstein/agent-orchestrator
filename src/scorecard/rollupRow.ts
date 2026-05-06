/** Internal rollup row merge — extracted so per-fn cyclomatic stays under ESLint / Fallow-style caps. */

/** Same fields as `NamedCounters` in aggregate.ts (no import to avoid cycles). */
export interface NamedCountersSlice {
  dry_plan_count: number;
  o5_skip_count: number;
  hitl_count: number;
}

/** Row accumulator during JSONL parse tests may build this shape directly. */
export interface RollupAccumShape {
  run_id: string;
  named: NamedCountersSlice;
  counts_by_step: Record<string, number>;
  tokens_in_total: number;
  tokens_out_total: number;
  started_at: string | null;
  ended_at: string | null;
  decisionTokens: string[];
  supervisorIds: string[];
  supervisorDoneOutcomes: string[];
  hasSupervisorBlocked: boolean;
}

function mergeStepCounts(into: Record<string, number>, step: string): void {
  into[step] = (into[step] ?? 0) + 1;
}

function bumpNamed(c: NamedCountersSlice, step: string): void {
  if (step === "dry_plan") c.dry_plan_count += 1;
  else if (step === "planner_skipped") c.o5_skip_count += 1;
  else if (step === "hitl_escalation") c.hitl_count += 1;
}

function parseDecisions(row: Record<string, unknown>): string[] {
  const d = row.decisions;
  if (!Array.isArray(d)) return [];
  return d.filter((x): x is string => typeof x === "string");
}

function applyRunIdentity(acc: RollupAccumShape, row: Record<string, unknown>): void {
  const ri = row.run_id;
  if (typeof ri === "string" && ri) acc.run_id = ri;
}

function applyTimestamps(acc: RollupAccumShape, row: Record<string, unknown>): void {
  const ts = row.timestamp;
  if (typeof ts !== "string" || ts.length === 0) return;
  if (acc.started_at === null || ts < acc.started_at) acc.started_at = ts;
  if (acc.ended_at === null || ts > acc.ended_at) acc.ended_at = ts;
}

function applyTokenTotals(acc: RollupAccumShape, row: Record<string, unknown>): void {
  const ti = row.tokens_in;
  const to = row.tokens_out;
  if (typeof ti === "number" && Number.isFinite(ti)) acc.tokens_in_total += ti;
  if (typeof to === "number" && Number.isFinite(to)) acc.tokens_out_total += to;
}

function captureSupervisorIdFromAgent(agent: string, into: string[]): void {
  const m = /^([a-z0-9-]+)-supervisor$/.exec(agent);
  if (m?.[1]) into.push(m[1]);
}

function captureSupervisorDoneOutcome(tokens: string[], into: string[]): void {
  const statusTok = tokens.find((t) => t.startsWith("status="));
  if (statusTok) into.push(statusTok.slice("status=".length));
}

function applyStepSemantic(
  acc: RollupAccumShape,
  step: string,
  agent: string,
  tokens: string[],
): void {
  if (step === "supervisor_spawn") {
    captureSupervisorIdFromAgent(agent, acc.supervisorIds);
    return;
  }
  if (step === "supervisor_done") {
    captureSupervisorDoneOutcome(tokens, acc.supervisorDoneOutcomes);
    return;
  }
  if (step === "supervisor_blocked") acc.hasSupervisorBlocked = true;
}

export function mergeRollupRow(acc: RollupAccumShape, row: Record<string, unknown>): void {
  const step = typeof row.step === "string" ? row.step : "";
  if (!step) return;
  mergeStepCounts(acc.counts_by_step, step);
  bumpNamed(acc.named, step);
  applyRunIdentity(acc, row);
  applyTimestamps(acc, row);
  applyTokenTotals(acc, row);
  const tokens = parseDecisions(row);
  acc.decisionTokens.push(...tokens);
  const agent = typeof row.agent === "string" ? row.agent : "";
  applyStepSemantic(acc, step, agent, tokens);
}
