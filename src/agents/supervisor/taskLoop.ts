import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";
import type { PlannerTaskT } from "../planner/schema.js";
import type { StackProfile } from "../../stacks/types.js";
import { runSubagent } from "../subagent/index.js";
import { type GateKind } from "../../gates/runQuality.js";
import {
  gateFixLoopUntilStop,
  pushVisited,
  type RunSupervisorDeps,
  type SupervisorEstimateKind,
  type SupervisorScratchForTasks,
} from "./taskLoopHelpers.js";

export async function runOneSupervisorTask(input: {
  task: PlannerTaskT;
  profile: StackProfile;
  cwd: string;
  stackOverlay?: string;
  ctx: OrchestratorContextT;
  deps: RunSupervisorDeps;
  scratch: SupervisorScratchForTasks;
  estimate: (k: SupervisorEstimateKind) => number;
  cap: number;
  gateKind: GateKind;
  maxFixLoops: number;
}): Promise<void> {
  const { task, profile, cwd, stackOverlay, ctx, deps, scratch, estimate, cap, gateKind, maxFixLoops } = input;
  const { visited, tokensDelta, taskResults } = scratch;
  pushVisited(visited, `subagent:${task.id}`, cap);
  tokensDelta.subagent += estimate("subagent");
  const sub = await runSubagent(
    {
      task,
      stackProfile: profile,
      ...(stackOverlay !== undefined ? { stackOverlay } : {}),
      path_ownership_map: ctx.path_ownership_map,
    },
    { completion: deps.subagentCompletion },
  );
  if (sub.status !== "patch") {
    const initialSkipped = sub.status === "no_change";
    if (!initialSkipped) scratch.anyTaskHumanClarify = true;
    taskResults.push({
      task_id: task.id,
      state: initialSkipped ? "skipped" : "red",
      fix_loop_count: 0,
      notes: sub.rationale.slice(0, 120),
    });
    return;
  }
  scratch.patches.push({ task_id: task.id, patch: sub.patch, attempt: 0 });
  const loc = { attempt: scratch.attemptCounter[task.id] ?? 0, lastGateLog: "", lastFailingGate: "" };
  const gateResult = await gateFixLoopUntilStop({
    task,
    profile,
    cwd,
    stackOverlay,
    ctx,
    deps,
    scratch,
    sub,
    estimate,
    cap,
    gateKind,
    maxFixLoops,
    loc,
  });
  taskResults.push({
    task_id: task.id,
    state: gateResult.green ? "green" : "red",
    fix_loop_count: gateResult.attempts,
    notes: gateResult.green ? `green after ${gateResult.attempts} fix-loop(s)` : `red: ${gateResult.lastFailingGate}`,
  });
}
