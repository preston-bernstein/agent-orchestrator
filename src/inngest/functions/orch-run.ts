/**
 * I3 deliverable per vault `Orchestration PoC/Inngest Integration Plan.md` §I3
 * + ADR 0002 (orchestrator-local). Vertical slice mirror of vault starter
 * `Build/RepoKits/agent-orchestrator/inngest-orch-run.ts.starter`:
 *   expectations → tf-probe → o5-dry-run → plan → branch on event →
 *   fan-out supervisors → waitForEvent per supervisor → resume → audit-finalize.
 *
 * Concurrency: `concurrency.key = event.data.runId` (limit 1) replaces the
 * hand-rolled per-repo `.agent-orchestrator.lock` (edge 40, task 44). No `0`
 * fall-through — match-key serialization is the contract.
 *
 * Step retries (lifted to `2` per Plan §I4 / task 40): Inngest v3 retry config
 * is FUNCTION-LEVEL — non-`mastra-*` steps idempotent by construction
 * (expectations / tf-probe pure reads, o5-dry-run = git status, persist-plan
 * atomic tmp→rename, audit-* single-writer JSONL append). `mastra-*` replay
 * safety lands at I4 via TF idempotency cache (`src/tf/cache.ts`, task 40).
 *
 * Forbidden (Plan §I4): nested `inngest.send()` from inside a Mastra Workflow
 * or Agent tool — would create a second scheduler under the outer DAG and
 * break replay determinism.
 *
 * Stub boundaries (TODO markers point at canonical task that wires the real
 * impl). Repo already has live impls for several of these (loadExpectations,
 * tfProbe, plannerDryRun, runSupervisorBranch, AuditWriter); I3 deliberately
 * keeps the in-file stubs to mirror vault canon and keep the test harness
 * isolated from live wiring (E2E lands at I3+ once Inngest dev server can
 * drive the function end-to-end).
 *
 * NOTE: this file is excluded from coverage per `vitest.config.ts`
 * (`src/inngest/**`); `orchRunHandler` exercised by integration test in
 * `tests/integration/inngest-orch-run.test.ts`.
 */

import { inngest } from "../client.js";

// ===== TEMPORARY STUBS — replace at indicated tasks =====

// TODO(task 21–22 SF1): import from '../../config/expectations.js'
async function loadExpectations(): Promise<Ctx> {
  return {
    runId: "pending",
    audit: { path: "", prevHash: "0".repeat(64) },
    expectationsLoaded: true,
  };
}

// TODO(task 6, edge 45): import from '../../tf/client.js'
async function tfProbe(_ctx: Ctx): Promise<{ structuredOutput: boolean; toolUse: boolean }> {
  return { structuredOutput: true, toolUse: true };
}

// TODO(task 25–26 SF2 / O5): import from '../../planner/plannerDryRun.js'
async function plannerDryRun(_ctx: Ctx): Promise<{ skip: boolean; reason: string }> {
  return { skip: false, reason: "stub: assume continue" };
}

// TODO(Phase 4): import from '../../agents/planner.js' (Mastra Agent invocation).
// I4 task 40 wraps the TF call w/ TfCache.tfCall(cache, ctx, 'planner', canonicalPrompt, fetchFn).
async function mastraPlanner(_ctx: Ctx, event: OrchEventLike): Promise<PlanArtifact> {
  return { tasks: [], specSlug: event.data.specSlug, repo: event.data.repo };
}

// TODO(Phase 4): import from '../../runs/plan.js'
async function writePlanJson(ctx: Ctx, _plan: PlanArtifact): Promise<{ path: string }> {
  return { path: `runs/${ctx.runId}/plan.json` };
}

// TODO(task 7): import from '../../audit/jsonl.js' (single AuditWriter per run).
async function audit(
  _ctx: Ctx,
  _decision: AuditDecision,
  _extra?: Record<string, unknown>,
): Promise<void> {
  // Stub — real impl writes hash-chained JSONL to runs/<runId>/audit.jsonl.
}

// TODO(Phase 5): import from '../../agents/supervisor.js' (Mastra Workflow → checkpoint).
async function mastraSupervisor(
  _ctx: Ctx,
  stack: "spring" | "react",
  _plan: PlanArtifact,
): Promise<SupervisorCheckpoint> {
  return { stack, diffHash: "pending", pendingDiffPath: "" };
}

// TODO(Phase 5): supervisor resume from checkpoint after approval event.
async function mastraSupervisorResume(
  _ctx: Ctx,
  _checkpoint: SupervisorCheckpoint,
): Promise<{ ok: true }> {
  return { ok: true };
}

// ===== TYPES =====

type Ctx = {
  runId: string;
  audit: { path: string; prevHash: string };
  expectationsLoaded: boolean;
  // I4 task 40 + 23: per-LLM-call idempotency keys recorded on RunContext.
  // `${runId}:${agentName}:${sha256(canonicalPromptJson)}` — see src/tf/cache.ts.
  llmCalls?: Array<{ agentName: string; idempotencyKey: string; cacheHit: boolean }>;
};

type PlanArtifact = {
  tasks: Array<{ id: string; target_paths: string[] }>;
  specSlug: string;
  repo: "spring-api" | "react-ui" | "agent-orchestrator";
};

type SupervisorCheckpoint = {
  stack: "spring" | "react";
  diffHash: string;
  pendingDiffPath: string;
};

type AuditDecision =
  | "expectations_loaded"
  | "tf_probe_ok"
  | "planner_skipped"
  | "planner_continue"
  | "dry_plan"
  | "execution_started"
  | "execution_done";

type OrchEventLike = {
  name: "orch/dry-plan.requested" | "orch/run.requested";
  data: {
    runId: string;
    specSlug: string;
    repo: "spring-api" | "react-ui" | "agent-orchestrator";
  };
};

// Minimal step shape used by `orchRunHandler`. Mirrors the surface of the
// Inngest v3 `step` argument we actually consume so the handler stays
// directly callable from vitest w/o spinning up the full SDK harness.
export type OrchStep = {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
  waitForEvent(
    id: string,
    args: { event: string; match: string; timeout: string },
  ): Promise<{ name: string; data: unknown }>;
};

type OrchRunResult =
  | { status: "skipped_no_change_needed"; reason: string }
  | { status: "dry_plan_done"; planPath: string }
  | { status: "green" };

// ===== HANDLER =====

export async function orchRunHandler({
  event,
  step,
}: {
  event: OrchEventLike;
  step: OrchStep;
}): Promise<OrchRunResult> {
  // 1. Boot ritual — every run, every time.
  const ctx = await step.run("expectations", loadExpectations);
  await step.run("audit-expectations", () => audit(ctx, "expectations_loaded"));

  const probe = await step.run("tf-probe", () => tfProbe(ctx));
  await step.run("audit-tf-probe", () => audit(ctx, "tf_probe_ok", { probe }));

  // 2. O5 deterministic skip — cheap before any TF spend.
  const skip = await step.run("o5-dry-run", () => plannerDryRun(ctx));
  if (skip.skip) {
    await step.run("audit-planner-skipped", () =>
      audit(ctx, "planner_skipped", { reason: skip.reason }),
    );
    return { status: "skipped_no_change_needed", reason: skip.reason };
  }
  await step.run("audit-planner-continue", () =>
    audit(ctx, "planner_continue", { reason: skip.reason }),
  );

  // 3. Plan — one Inngest step = whole Mastra Agent run; idempotency at TF wrapper (I4).
  const plan = await step.run("plan", () => mastraPlanner(ctx, event));
  const planArtifact = await step.run("persist-plan", () => writePlanJson(ctx, plan));
  await step.run("audit-plan", () => audit(ctx, "dry_plan", { planPath: planArtifact.path }));

  // 4. Dry-plan branch — STOP before any supervisor / managed-repo subprocess.
  if (event.name === "orch/dry-plan.requested") {
    return { status: "dry_plan_done", planPath: planArtifact.path };
  }

  // 5. Execute lane — fan-out supervisors in parallel.
  await step.run("audit-execution-started", () => audit(ctx, "execution_started"));

  const [springCheckpoint, reactCheckpoint] = await Promise.all([
    step.run("mastra-spring-pre-approval", () => mastraSupervisor(ctx, "spring", plan)),
    step.run("mastra-react-pre-approval", () => mastraSupervisor(ctx, "react", plan)),
  ]);

  // 6. HITL — per-supervisor wait. `match: 'data.runId'` ensures only the
  // approval for THIS run unblocks. 7d timeout per Plan §I3.
  await Promise.all([
    step.waitForEvent("approve-spring", {
      event: "orch/approve.spring",
      match: "data.runId",
      timeout: "7d",
    }),
    step.waitForEvent("approve-react", {
      event: "orch/approve.react",
      match: "data.runId",
      timeout: "7d",
    }),
  ]);

  // 7. Resume from checkpoint after approval.
  await Promise.all([
    step.run("mastra-spring-resume", () => mastraSupervisorResume(ctx, springCheckpoint)),
    step.run("mastra-react-resume", () => mastraSupervisorResume(ctx, reactCheckpoint)),
  ]);

  await step.run("audit-finalize", () => audit(ctx, "execution_done"));
  return { status: "green" };
}

// ===== INNGEST FUNCTION =====

export const orchRun = inngest.createFunction(
  {
    id: "orch-run",
    // Per-runId serialization replaces edge-40 lockfile (task 44).
    concurrency: [{ key: "event.data.runId", limit: 1 }],
    // I4 (task 40) lifts to 2; mastra-* replay-safe via TF idempotency cache.
    retries: 2,
  },
  [{ event: "orch/dry-plan.requested" }, { event: "orch/run.requested" }],
  // Cast: Inngest's typed `step` is narrower than `OrchStep` (more methods),
  // wider in waitForEvent options. The handler only uses the intersection.
  ({ event, step }) =>
    orchRunHandler({
      event: event as OrchEventLike,
      step: step as unknown as OrchStep,
    }),
);
