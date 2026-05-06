import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";
import type { PlannerTaskT } from "../planner/schema.js";
import type { StackProfile } from "../../stacks/types.js";
import { CycleAbortError } from "./cycleAbortError.js";
import { runFixSubagent } from "../fixSubagent.js";
import { runQuality } from "../../gates/runQuality.js";
import type { GateInvocation, GateKind } from "../../gates/types.js";
import type {
  RunSupervisorDeps,
  SupervisorEstimateKind,
  SupervisorScratchForTasks,
} from "./types.js";

export type {
  RunSupervisorDeps,
  SupervisorEstimateKind,
  SupervisorFixTarget,
  SupervisorScratchForTasks,
  SupervisorTaskResult,
} from "./types.js";

export function pushVisited(visited: string[], node: string, cap: number): void {
  visited.push(node);
  if (visited.length > cap) {
    throw new CycleAbortError(visited, cap);
  }
}

type GateFixIter = "green" | "retry" | "stop_cap" | "stop_clarify";

interface SupervisorGateFixParams {
  task: PlannerTaskT;
  profile: StackProfile;
  cwd: string;
  stackOverlay: string | undefined;
  ctx: OrchestratorContextT;
  deps: RunSupervisorDeps;
  scratch: SupervisorScratchForTasks;
  sub: { status: string; patch: string; rationale: string };
  estimate: (k: SupervisorEstimateKind) => number;
  cap: number;
  gateKind: GateKind;
  maxFixLoops: number;
  loc: { attempt: number; lastGateLog: string; lastFailingGate: string };
}

function mergedPatchesForTask(
  patches: { task_id: string; patch: string; attempt: number }[],
  taskId: string,
  fallback: string,
): string {
  const merged = patches.filter((p) => p.task_id === taskId).map((p) => p.patch).join("\n");
  return merged || fallback;
}

async function supervisorGateFixIteration(p: SupervisorGateFixParams): Promise<GateFixIter> {
  const { task, profile, cwd, stackOverlay, ctx, deps, scratch, sub, estimate, cap, gateKind, maxFixLoops, loc } = p;
  const { visited, attemptCounter, tokensDelta, gateHistory, patches, fixTargets } = scratch;
  pushVisited(visited, `gate:${task.id}:${loc.attempt}`, cap);
  const runGate = (): Promise<GateInvocation> =>
    runQuality({ profile, cwd, kind: gateKind }, deps.exec ? { exec: deps.exec } : {});
  const gate = deps.wrapGateRun
    ? await deps.wrapGateRun(`gate:${task.id}:${gateKind}:a${loc.attempt}`, runGate)
    : await runGate();
  gateHistory.push(gate);
  if (gate.exit === 0) return "green";
  loc.lastGateLog = gate.log_tail;
  loc.lastFailingGate = `${profile.id}:${gateKind}`;
  loc.attempt += 1;
  attemptCounter[task.id] = loc.attempt;
  if (loc.attempt > maxFixLoops) {
    scratch.anyTaskBudgetCap = true;
    fixTargets.push({ task_id: task.id, failing_gate: loc.lastFailingGate, log_excerpt: loc.lastGateLog.slice(0, 800) });
    return "stop_cap";
  }
  pushVisited(visited, `fix-subagent:${task.id}:${loc.attempt}`, cap);
  tokensDelta["fix-subagent"] += estimate("fix-subagent");
  const priorPatch = mergedPatchesForTask(patches, task.id, sub.patch);
  const fix = await runFixSubagent(
    {
      task,
      stackProfile: profile,
      ...(stackOverlay !== undefined ? { stackOverlay } : {}),
      prior_patch: priorPatch,
      gate_log_excerpt: loc.lastGateLog,
      failing_gate: loc.lastFailingGate,
      attempt: loc.attempt,
      max_fix_loops: maxFixLoops,
      path_ownership_map: ctx.path_ownership_map,
    },
    { completion: deps.fixSubagentCompletion },
  );
  if (fix.status !== "patch") {
    scratch.anyTaskHumanClarify = true;
    fixTargets.push({
      task_id: task.id,
      failing_gate: loc.lastFailingGate,
      log_excerpt: `fix-subagent ${fix.status}: ${fix.rationale}`.slice(0, 800),
    });
    return "stop_clarify";
  }
  patches.push({ task_id: task.id, patch: fix.patch, attempt: loc.attempt });
  return "retry";
}

export async function gateFixLoopUntilStop(p: SupervisorGateFixParams): Promise<{ green: boolean; attempts: number; lastFailingGate: string }> {
  while (true) {
    const step = await supervisorGateFixIteration(p);
    if (step === "green") return { green: true, attempts: p.loc.attempt, lastFailingGate: p.loc.lastFailingGate };
    if (step !== "retry") return { green: false, attempts: p.loc.attempt, lastFailingGate: p.loc.lastFailingGate };
  }
}
