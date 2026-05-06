import path from "node:path";
import { loadBootConfig } from "../../config/env.js";
import { AuditWriter } from "../../audit/jsonl.js";
import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";
import { atomicWriteJson } from "../../runs/state.js";
import { loadManagedRepos } from "../../config/managedRepos.js";
import { runMockExecuteLane } from "../../cli/mockExecuteLane.js";
import type { GateInvocation } from "../../gates/types.js";
import type {
  RunExecuteLaneInput,
  RunExecuteLaneDeps,
  RunExecuteLaneResult,
} from "../../workflows/executeLane.js";
import type { PlannerBranchOutcome } from "../../workflows/plannerBranch.js";
import type { OrchStep, OrchRunOverrides, OrchRunResult, OrchRunEvent } from "./types.js";
import { approveWaitPlans, supervisorsAwaitingApproval } from "./helpers.js";
import { auditTailPrevHash } from "./auditTailHash.js";

function persistCtx(ctx: OrchestratorContextT, tailHash: string): void {
  atomicWriteJson({ path: ctx.state_file_path, data: { ...ctx, prev_hash: tailHash } });
}

export async function orchRunExecLane(
  step: OrchStep,
  input: RunExecuteLaneInput,
  overrides?: OrchRunOverrides,
): Promise<RunExecuteLaneResult> {
  const laneDeps: Partial<RunExecuteLaneDeps> = {
    wrapSupervisorTaskRun: async (tid: string, fn: () => Promise<void>) => {
      await step.run(`sup-task:${tid}`, fn);
    },
    wrapGateRun: async (gateStepId: string, fn: () => Promise<GateInvocation>) =>
      step.run(gateStepId, fn),
  };
  if (!loadBootConfig().mockTf) {
    throw new Error(
      "orch/run.execute requires MOCK_TF=1 on the worker (real subagent TF not wired for Inngest yet)",
    );
  }
  if (overrides?.runExecuteLane) {
    const full: RunExecuteLaneDeps = {
      subagentCompletion: async () => ({}),
      fixSubagentCompletion: async () => ({}),
      ...laneDeps,
    };
    return overrides.runExecuteLane(input, full);
  }
  return runMockExecuteLane(input, laneDeps);
}

async function orchWaitApprovals(
  step: OrchStep,
  approvalKind: RunExecuteLaneResult["approval"]["kind"],
  lane: Pick<RunExecuteLaneResult, "supervisors">,
): Promise<void> {
  if (approvalKind !== "paused_for_approval") return;
  const waits = approveWaitPlans(supervisorsAwaitingApproval(lane));
  await Promise.all(
    waits.map((w) =>
      step.waitForEvent(w.stepId, {
        event: w.event,
        match: "data.runId",
        timeout: "7d",
      }),
    ),
  );
}

async function orchFinalize(step: OrchStep, ctx: OrchestratorContextT): Promise<void> {
  await step.run("audit-finalize", async () => {
    const prev = auditTailPrevHash(ctx.audit_path, ctx.prev_hash);
    const w = new AuditWriter({ path: ctx.audit_path, prevHash: prev });
    w.write({
      run_id: ctx.run_id,
      step: "execution_done",
      agent: "system",
      decisions: ["inngest-orch-run"],
      timestamp: new Date().toISOString(),
    });
    persistCtx(ctx, w.currentPrevHash);
  });
}

export async function orchRouteAfterPlanner(
  step: OrchStep,
  event: OrchRunEvent,
  ctx: OrchestratorContextT,
  outcome: PlannerBranchOutcome,
  overrides?: OrchRunOverrides,
): Promise<OrchRunResult> {
  if (outcome.kind === "skipped") {
    return { status: "skipped_no_change_needed", reason: outcome.reason };
  }
  const planPath =
    outcome.kind === "dry_plan" || outcome.kind === "execution_started"
      ? outcome.planPath
      : "";
  if (event.name === "orch/dry-plan.requested") {
    return { status: "dry_plan_done", planPath };
  }
  if (outcome.kind !== "execution_started") {
    return { status: "skipped_no_change_needed", reason: "unexpected_planner_kind" };
  }
  const repos = await step.run("load-managed-repos", async () =>
    (overrides?.loadManagedRepos?.() ??
      loadManagedRepos({ envRaw: process.env.ORCH_MANAGED_REPOS ?? "" })),
  );
  const input: RunExecuteLaneInput = {
    ctx,
    plan: outcome.plan,
    repos,
    runDir: path.dirname(ctx.state_file_path),
  };
  const lane = await orchRunExecLane(step, input, overrides);
  await orchWaitApprovals(step, lane.approval.kind, lane);
  await orchFinalize(step, ctx);
  return { status: "green" };
}
