import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";
import type { StackProfile } from "../../stacks/types.js";
import type { PlannerTaskT } from "../planner/schema.js";
import {
  type SupervisorOutputT,
  type SupervisorTaskResultT,
  type SupervisorFixTargetT,
} from "./schema.js";
import { type GateInvocation, type GateKind } from "../../gates/runQuality.js";
import { runOneSupervisorTask } from "./taskLoop.js";
import type { RunSupervisorDeps, SupervisorEstimateKind } from "./types.js";

export { CycleAbortError } from "./cycleAbortError.js";
export type { RunSupervisorDeps, SupervisorEstimateKind } from "./types.js";

export interface RunSupervisorInput {
  tasks: readonly PlannerTaskT[];
  ctx: OrchestratorContextT;
  profile: StackProfile;
  stackOverlay?: string;
  cwd: string;
  supervisorId: string;
  visited?: readonly string[];
  gateKind?: GateKind;
  runDir?: string;
}

export interface RunSupervisorResult {
  output: SupervisorOutputT;
  visited_nodes: readonly string[];
  attempt_counter: Readonly<Record<string, number>>;
  tokens_delta: Readonly<{
    supervisor: number;
    subagent: number;
    "fix-subagent": number;
  }>;
  gate_history: readonly GateInvocation[];
  patches: readonly {
    task_id: string;
    patch: string;
    attempt: number;
  }[];
}

const DEFAULT_TOKEN_EST: Record<SupervisorEstimateKind, number> = {
  supervisor: 1000,
  subagent: 4000,
  "fix-subagent": 2000,
};

function defaultEstimate(kind: SupervisorEstimateKind): number {
  return DEFAULT_TOKEN_EST[kind];
}

function firstSharedPath(
  pathsA: readonly string[],
  pathsB: readonly string[],
): string | null {
  for (const p of pathsA) {
    if (pathsB.includes(p)) return p;
  }
  return null;
}

function overlapWithLaterTasks(
  ti: PlannerTaskT,
  tasks: readonly PlannerTaskT[],
  startJ: number,
): { otherId: string; path: string } | null {
  for (let j = startJ; j < tasks.length; j++) {
    const tj = tasks[j] as PlannerTaskT;
    const shared = firstSharedPath(ti.paths, tj.paths);
    if (shared) return { otherId: tj.id, path: shared };
  }
  return null;
}

export function findPathOverlap(
  tasks: readonly PlannerTaskT[],
): { a: string; b: string; path: string } | null {
  for (let i = 0; i < tasks.length; i++) {
    const ti = tasks[i] as PlannerTaskT;
    const hit = overlapWithLaterTasks(ti, tasks, i + 1);
    if (hit) return { a: ti.id, b: hit.otherId, path: hit.path };
  }
  return null;
}

interface BudgetTracker {
  supervisor: number;
  subagent: number;
  "fix-subagent": number;
}

function checkSupervisorBudget(
  ctx: OrchestratorContextT,
  delta: BudgetTracker,
): boolean {
  const cap = ctx.tokens_budget.supervisor;
  const spent = ctx.tokens_spent["supervisor"] ?? 0;
  return spent + delta.supervisor <= cap;
}

interface SupervisorRunScratch {
  visited: string[];
  attemptCounter: Record<string, number>;
  tokensDelta: BudgetTracker;
  gateHistory: GateInvocation[];
  patches: { task_id: string; patch: string; attempt: number }[];
  taskResults: SupervisorTaskResultT[];
  fixTargets: SupervisorFixTargetT[];
  anyTaskBudgetCap: boolean;
  anyTaskHumanClarify: boolean;
}

function haltForPathOverlap(
  tasks: readonly PlannerTaskT[],
  ov: { a: string; b: string; path: string },
  scratch: SupervisorRunScratch,
): RunSupervisorResult {
  const { visited, attemptCounter, tokensDelta, gateHistory, patches } = scratch;
  return {
    output: {
      status: "needs_human_clarify",
      rationale: `path overlap: ${ov.a} vs ${ov.b}`,
      task_results: tasks.map((t) => ({
        task_id: t.id,
        state: "skipped",
        fix_loop_count: 0,
        notes: "path overlap refusal",
      })),
      next_action: "halt",
      fix_targets: [],
    },
    visited_nodes: visited,
    attempt_counter: attemptCounter,
    tokens_delta: tokensDelta,
    gate_history: gateHistory,
    patches,
  };
}

function haltForBootBudget(
  tasks: readonly PlannerTaskT[],
  scratch: SupervisorRunScratch,
): RunSupervisorResult {
  const { visited, attemptCounter, tokensDelta, gateHistory, patches } = scratch;
  return {
    output: {
      status: "budget_exhausted",
      rationale: "supervisor token budget exhausted at boot",
      task_results: tasks.map((t) => ({
        task_id: t.id,
        state: "skipped",
        fix_loop_count: 0,
        notes: "supervisor budget cap hit",
      })),
      next_action: "halt",
      fix_targets: [],
    },
    visited_nodes: visited,
    attempt_counter: attemptCounter,
    tokens_delta: tokensDelta,
    gate_history: gateHistory,
    patches,
  };
}

function writePendingDiffIfAllGreen(
  input: RunSupervisorInput,
  allGreen: boolean,
  patches: SupervisorRunScratch["patches"],
): string | undefined {
  if (!allGreen || !input.runDir) return undefined;
  const supDir = path.join(input.runDir, input.supervisorId);
  mkdirSync(supDir, { recursive: true });
  const pendingDiffPath = path.join(supDir, "pending.diff");
  writeFileSync(
    pendingDiffPath,
    patches.map((p) => p.patch).join("\n"),
    "utf8",
  );
  return pendingDiffPath;
}

function deriveSupervisorCompletionFields(
  scratch: SupervisorRunScratch,
  allGreen: boolean,
): Pick<SupervisorOutputT, "status" | "next_action" | "rationale"> {
  const { taskResults, anyTaskBudgetCap, anyTaskHumanClarify } = scratch;
  if (anyTaskBudgetCap) {
    return {
      status: "budget_exhausted",
      next_action: "halt",
      rationale: "fix-loop cap hit on ≥1 task",
    };
  }
  if (anyTaskHumanClarify) {
    return {
      status: "needs_human_clarify",
      next_action: "halt",
      rationale: "subagent or fix-subagent refused on ≥1 task",
    };
  }
  if (allGreen) {
    return {
      status: "done",
      next_action: "hand_off_to_reviewer",
      rationale: `all ${taskResults.length} task(s) green`,
    };
  }
  return {
    status: "done",
    next_action: "hand_off_to_reviewer",
    rationale: `${taskResults.filter((r) => r.state === "skipped").length} skipped, rest green`,
  };
}

function buildSupervisorFinalReturn(
  input: RunSupervisorInput,
  scratch: SupervisorRunScratch,
): RunSupervisorResult {
  const {
    visited,
    attemptCounter,
    tokensDelta,
    gateHistory,
    patches,
    taskResults,
    fixTargets,
  } = scratch;

  const allGreen =
    taskResults.length > 0 && taskResults.every((r) => r.state === "green");
  const pendingDiffPath = writePendingDiffIfAllGreen(input, allGreen, patches);
  const completion = deriveSupervisorCompletionFields(scratch, allGreen);

  return {
    output: {
      status: completion.status,
      rationale: completion.rationale.slice(0, 200),
      task_results: taskResults,
      next_action: completion.next_action,
      fix_targets: fixTargets,
      ...(pendingDiffPath ? { pending_diff_path: pendingDiffPath } : {}),
    },
    visited_nodes: visited,
    attempt_counter: attemptCounter,
    tokens_delta: tokensDelta,
    gate_history: gateHistory,
    patches,
  };
}

function supervisorBootChecks(
  input: RunSupervisorInput,
  scratch: SupervisorRunScratch,
  estimate: (k: SupervisorEstimateKind) => number,
): RunSupervisorResult | null {
  const overlap = findPathOverlap(input.tasks);
  if (overlap) {
    return haltForPathOverlap(input.tasks, overlap, scratch);
  }

  scratch.tokensDelta.supervisor += estimate("supervisor");
  if (!checkSupervisorBudget(input.ctx, scratch.tokensDelta)) {
    return haltForBootBudget(input.tasks, scratch);
  }
  return null;
}

export async function runSupervisor(
  input: RunSupervisorInput,
  deps: RunSupervisorDeps,
): Promise<RunSupervisorResult> {
  const estimate = deps.estimateTokens ?? defaultEstimate;
  const scratch: SupervisorRunScratch = {
    visited: [...(input.visited ?? input.ctx.visited_nodes)],
    attemptCounter: { ...input.ctx.attempt_counter },
    tokensDelta: {
      supervisor: 0,
      subagent: 0,
      "fix-subagent": 0,
    },
    gateHistory: [],
    patches: [],
    taskResults: [],
    fixTargets: [],
    anyTaskBudgetCap: false,
    anyTaskHumanClarify: false,
  };

  const early = supervisorBootChecks(input, scratch, estimate);
  if (early) return early;

  const cap = input.ctx.graph_depth_cap;
  const gateKind: GateKind = input.gateKind ?? "fast";
  const maxFixLoops = input.ctx.max_fix_loops;

  const wrap = deps.wrapSupervisorTaskRun;
  for (const task of input.tasks) {
    const execTask = (): Promise<void> =>
      runOneSupervisorTask({
        task,
        profile: input.profile,
        cwd: input.cwd,
        stackOverlay: input.stackOverlay,
        ctx: input.ctx,
        deps,
        scratch,
        estimate,
        cap,
        gateKind,
        maxFixLoops,
      });
    await (wrap?.(`${input.supervisorId}:${task.id}`, execTask) ?? execTask());
  }

  return buildSupervisorFinalReturn(input, scratch);
}
