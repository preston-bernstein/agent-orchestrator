import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { AssembledPrompt } from "../llm/assemblePrompt.js";
import type { StackProfile } from "../stacks/types.js";
import type { PlannerTaskT } from "./planner.schema.js";
import {
  type SupervisorOutputT,
  type SupervisorTaskResultT,
  type SupervisorFixTargetT,
} from "./supervisor.schema.js";
import { runSubagent } from "./subagent.js";
import { runFixSubagent } from "./fixSubagent.js";
import {
  runQuality,
  type GateInvocation,
  type GateKind,
  type RunQualityDeps,
} from "../gates/runQuality.js";

/**
 * Generic Supervisor (vault `Build/Prompts/supervisor-base.md`). Spring +
 * React supervisors share this orchestration; stack overlay specializes
 * the prompts/cmds via `StackProfile`.
 *
 * Phase 5 scope:
 *   1. Path overlap check across in-flight tasks (vault §Behavior #1).
 *   2. Per-task spawn pattern: subagent → gate → fix-loop until green or
 *      `max_fix_loops` (edge 10).
 *   3. Cycle guard via `visited_nodes` push + `graph_depth_cap` (edge 32).
 *   4. O3 token budget enforcement (`tokens_spent.supervisor + projected
 *      > tokens_budget.supervisor`).
 *   5. Approval prep: write merged-diff to `runs/<id>/<sup>/pending.diff`
 *      when all tasks green; set `pending_diff_path` (vault §Behavior #10).
 *
 * Out of scope (Phase 5; Phase 6 lands API-first edge lock + integration step
 * at the workflow layer, not inside this supervisor):
 *   - Cross-supervisor parallelism (Inngest absorbs durability + concurrency
 *     per ADR 0003 — tasks 35–46, HITL-gated).
 *   - Real `git apply` to a managed repo working tree (Phase 5+ E2E).
 *   - Inngest durable shell (tasks 35–46, HITL-gated).
 */

export class CycleAbortError extends Error {
  constructor(
    public readonly visited: readonly string[],
    public readonly cap: number,
  ) {
    super(
      `cycle aborted: visited.length=${visited.length} > graph_depth_cap=${cap} ` +
        `(edge 32 mechanical guard)`,
    );
    this.name = "CycleAbortError";
  }
}

export class PathOverlapRefusal extends Error {
  constructor(public readonly a: string, public readonly b: string, public readonly path: string) {
    super(`path overlap: ${a} vs ${b} on '${path}'`);
    this.name = "PathOverlapRefusal";
  }
}

export interface RunSupervisorInput {
  tasks: readonly PlannerTaskT[];
  ctx: OrchestratorContextT;
  profile: StackProfile;
  stackOverlay?: string;
  /** Managed-repo cwd for gate exec. */
  cwd: string;
  /** Supervisor id for audit + pending-diff path (e.g. 'spring'). */
  supervisorId: string;
  /** Initial visited node stack (defaults to ctx.visited_nodes). */
  visited?: readonly string[];
  /** Override gate kind (Phase 5 default: 'fast'). */
  gateKind?: GateKind;
  /** Override `runs/<id>/` dir for pending.diff write (tests). */
  runDir?: string;
}

export interface RunSupervisorDeps {
  subagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  fixSubagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  /** Gate exec seam (default = real `child_process.execFile`). */
  exec?: RunQualityDeps["exec"];
  /**
   * Per-call token estimator. Supervisor cannot peek inside subagent
   * assembly cleanly, so estimate is injected. Defaults are O3-table-aware
   * (`Build/Patterns/O3-per-agent-token-budgets.md` §Default budgets) but
   * deliberately conservative.
   */
  estimateTokens?: (kind: "supervisor" | "subagent" | "fix-subagent") => number;
}

export interface RunSupervisorResult {
  output: SupervisorOutputT;
  /** Visited stack after run (caller persists into RunContext.visited_nodes). */
  visited_nodes: readonly string[];
  /** Updated attempt_counter (caller merges into RunContext). */
  attempt_counter: Readonly<Record<string, number>>;
  /** Per-role token spend delta (caller adds to RunContext.tokens_spent). */
  tokens_delta: Readonly<{
    supervisor: number;
    subagent: number;
    "fix-subagent": number;
  }>;
  /** Gate invocations (caller audits each). */
  gate_history: readonly GateInvocation[];
  /** In-memory patch journal — Phase 5 does NOT apply to working tree. */
  patches: readonly {
    task_id: string;
    patch: string;
    attempt: number;
  }[];
}

const DEFAULT_TOKEN_EST: Record<"supervisor" | "subagent" | "fix-subagent", number> = {
  supervisor: 1000,
  subagent: 4000,
  "fix-subagent": 2000,
};

function defaultEstimate(kind: "supervisor" | "subagent" | "fix-subagent"): number {
  return DEFAULT_TOKEN_EST[kind];
}

/**
 * Path overlap check (vault supervisor-base §Behavior #1). Refuses BEFORE
 * any LLM call — pure-fn, also re-tested by `tests/agents/supervisor.test.ts`.
 */
export function findPathOverlap(
  tasks: readonly PlannerTaskT[],
): { a: string; b: string; path: string } | null {
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const ti = tasks[i] as PlannerTaskT;
      const tj = tasks[j] as PlannerTaskT;
      for (const p of ti.paths) {
        if (tj.paths.includes(p)) {
          return { a: ti.id, b: tj.id, path: p };
        }
      }
    }
  }
  return null;
}

function pushVisited(
  visited: string[],
  node: string,
  cap: number,
): void {
  visited.push(node);
  if (visited.length > cap) {
    throw new CycleAbortError(visited, cap);
  }
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

export async function runSupervisor(
  input: RunSupervisorInput,
  deps: RunSupervisorDeps,
): Promise<RunSupervisorResult> {
  const estimate = deps.estimateTokens ?? defaultEstimate;
  const visited: string[] = [...(input.visited ?? input.ctx.visited_nodes)];
  const attemptCounter: Record<string, number> = {
    ...input.ctx.attempt_counter,
  };
  const tokensDelta: BudgetTracker = {
    supervisor: 0,
    subagent: 0,
    "fix-subagent": 0,
  };
  const gateHistory: GateInvocation[] = [];
  const patches: { task_id: string; patch: string; attempt: number }[] = [];
  const taskResults: SupervisorTaskResultT[] = [];
  const fixTargets: SupervisorFixTargetT[] = [];

  const overlap = findPathOverlap(input.tasks);
  if (overlap) {
    return {
      output: {
        status: "needs_human_clarify",
        rationale: `path overlap: ${overlap.a} vs ${overlap.b}`,
        task_results: input.tasks.map((t) => ({
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

  tokensDelta.supervisor += estimate("supervisor");
  if (!checkSupervisorBudget(input.ctx, tokensDelta)) {
    return {
      output: {
        status: "budget_exhausted",
        rationale: "supervisor token budget exhausted at boot",
        task_results: input.tasks.map((t) => ({
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

  const cap = input.ctx.graph_depth_cap;
  const gateKind: GateKind = input.gateKind ?? "fast";
  const maxFixLoops = input.ctx.max_fix_loops;

  let anyTaskBudgetCap = false;
  let anyTaskHumanClarify = false;

  for (const task of input.tasks) {
    pushVisited(visited, `subagent:${task.id}`, cap);
    tokensDelta.subagent += estimate("subagent");
    const sub = await runSubagent(
      {
        task,
        stackProfile: input.profile,
        ...(input.stackOverlay !== undefined
          ? { stackOverlay: input.stackOverlay }
          : {}),
        path_ownership_map: input.ctx.path_ownership_map,
      },
      { completion: deps.subagentCompletion },
    );

    if (sub.status !== "patch") {
      const initialSkipped = sub.status === "no_change";
      if (!initialSkipped) anyTaskHumanClarify = true;
      taskResults.push({
        task_id: task.id,
        state: initialSkipped ? "skipped" : "red",
        fix_loop_count: 0,
        notes: sub.rationale.slice(0, 120),
      });
      continue;
    }

    patches.push({ task_id: task.id, patch: sub.patch, attempt: 0 });

    let attempt = attemptCounter[task.id] ?? 0;
    let lastGateLog = "";
    let lastFailingGate = "";
    let green = false;

    while (true) {
      pushVisited(visited, `gate:${task.id}:${attempt}`, cap);
      const gate = await runQuality(
        { profile: input.profile, cwd: input.cwd, kind: gateKind },
        deps.exec ? { exec: deps.exec } : {},
      );
      gateHistory.push(gate);
      if (gate.exit === 0) {
        green = true;
        break;
      }
      lastGateLog = gate.log_tail;
      lastFailingGate = `${input.profile.id}:${gateKind}`;

      attempt += 1;
      attemptCounter[task.id] = attempt;
      if (attempt > maxFixLoops) {
        anyTaskBudgetCap = true;
        fixTargets.push({
          task_id: task.id,
          failing_gate: lastFailingGate,
          log_excerpt: lastGateLog.slice(0, 800),
        });
        break;
      }

      pushVisited(visited, `fix-subagent:${task.id}:${attempt}`, cap);
      tokensDelta["fix-subagent"] += estimate("fix-subagent");

      const priorPatch =
        patches
          .filter((p) => p.task_id === task.id)
          .map((p) => p.patch)
          .join("\n") || sub.patch;

      const fix = await runFixSubagent(
        {
          task,
          stackProfile: input.profile,
          ...(input.stackOverlay !== undefined
            ? { stackOverlay: input.stackOverlay }
            : {}),
          prior_patch: priorPatch,
          gate_log_excerpt: lastGateLog,
          failing_gate: lastFailingGate,
          attempt,
          max_fix_loops: maxFixLoops,
          path_ownership_map: input.ctx.path_ownership_map,
        },
        { completion: deps.fixSubagentCompletion },
      );

      if (fix.status !== "patch") {
        anyTaskHumanClarify = true;
        fixTargets.push({
          task_id: task.id,
          failing_gate: lastFailingGate,
          log_excerpt: `fix-subagent ${fix.status}: ${fix.rationale}`.slice(0, 800),
        });
        break;
      }
      patches.push({ task_id: task.id, patch: fix.patch, attempt });
    }

    taskResults.push({
      task_id: task.id,
      state: green ? "green" : "red",
      fix_loop_count: attempt,
      notes: green
        ? `green after ${attempt} fix-loop(s)`
        : `red: ${lastFailingGate}`,
    });
  }

  const allGreen =
    taskResults.length > 0 && taskResults.every((r) => r.state === "green");
  let pendingDiffPath: string | undefined;

  if (allGreen && input.runDir) {
    const supDir = path.join(input.runDir, input.supervisorId);
    mkdirSync(supDir, { recursive: true });
    pendingDiffPath = path.join(supDir, "pending.diff");
    writeFileSync(
      pendingDiffPath,
      patches.map((p) => p.patch).join("\n"),
      "utf8",
    );
  }

  let status: SupervisorOutputT["status"];
  let nextAction: SupervisorOutputT["next_action"];
  let rationale: string;
  if (anyTaskBudgetCap) {
    status = "budget_exhausted";
    nextAction = "halt";
    rationale = "fix-loop cap hit on ≥1 task";
  } else if (anyTaskHumanClarify) {
    status = "needs_human_clarify";
    nextAction = "halt";
    rationale = "subagent or fix-subagent refused on ≥1 task";
  } else if (allGreen) {
    status = "done";
    nextAction = "hand_off_to_reviewer";
    rationale = `all ${taskResults.length} task(s) green`;
  } else {
    status = "done";
    nextAction = "hand_off_to_reviewer";
    rationale = `${taskResults.filter((r) => r.state === "skipped").length} skipped, rest green`;
  }

  return {
    output: {
      status,
      rationale: rationale.slice(0, 200),
      task_results: taskResults,
      next_action: nextAction,
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
