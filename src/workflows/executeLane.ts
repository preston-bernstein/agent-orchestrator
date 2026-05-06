import path from "node:path";
import { readFile } from "node:fs/promises";
import type { AssembledPrompt } from "../llm/assemblePrompt.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { ManagedRepoMap, SupervisorId } from "../config/managedRepos.js";
import { cwdsFromManagedRepos } from "../config/managedRepos.js";
import { AuditWriter } from "../audit/jsonl.js";
import { formatApprovalArtifacts } from "../approval/formatApprovalArtifacts.js";
import {
  runReviewerDeterministic,
  type SupervisorReviewerSlice,
  type ReviewerIntegrationVerdict,
} from "../reviewer/deterministic.js";
import { runReviewerPhase2, type ReviewerPhase2Completion } from "../reviewer/phase2.js";
import type { ReviewerOutputT } from "../reviewer/schema.js";
import {
  runSupervisorBranch,
  type SupervisorBranchDeps,
  type SupervisorBranchResult,
} from "./supervisorBranch.js";
import {
  runIntegrationStep,
  type IntegrationStepResult,
} from "./integrationStep.js";
import { supervisorSpawnGuard } from "./plannerBranch.js";
import type { RunQualityDeps } from "../gates/runQuality.js";
import { auditHitlEscalation } from "../policy/hitl.js";

/**
 * Bridges plannerBranch.execute outcome → supervisorBranch with resolved
 * managed-repo cwds + boot-time validation, then dispatches
 * `runIntegrationStep` so the cross-repo contract gate runs on every lane.
 *
 * Defensive layers:
 *   1. `supervisorSpawnGuard(ctx.cli_flags)` — refuses unless `execute === true`
 *      (vault canon: A4 mutation gate). Even if caller forgets, guard fires.
 *   2. **Plan-vs-registry coverage check** — every supervisor id present in
 *      the plan MUST have a managed-repo entry. Else throws
 *      `MissingManagedRepoError` BEFORE any subagent call.
 *   3. Audit chain owned by ONE `AuditWriter` shared between supervisor
 *      branch + integration step (else prev_hash forks ⇒ chain break).
 *
 * Caller (CLI) supplies completion + exec deps. MOCK_TF=1 lane uses
 * mockSubagent + mockFix + mockExec. Real TF flips when subagent TF wiring
 * lands.
 */

export class MissingManagedRepoError extends Error {
  constructor(
    public readonly supervisorId: string,
    public readonly registered: readonly string[],
  ) {
    super(
      `plan references supervisor '${supervisorId}' but no managed repo registered ` +
        `(set ORCH_MANAGED_REPOS; registered=${JSON.stringify(registered)})`,
    );
    this.name = "MissingManagedRepoError";
  }
}

export interface RunExecuteLaneInput {
  ctx: OrchestratorContextT;
  plan: PlannerOutputT;
  repos: ManagedRepoMap;
  /** Override `runs/<run_id>/` dir (tests). */
  runDir?: string;
  /**
   * Prior green-run contract hash (sha256 hex) for integration agent
   * compare. `null` (default) = first run; integration emits `compatible`
   * + `proceed` regardless of new hash. Reviewer reads from
   * `runs/last-green/contract.hash`.
   */
  priorContractHash?: string | null;
}

export interface RunExecuteLaneDeps {
  subagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  fixSubagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  exec?: RunQualityDeps["exec"];
  estimateTokens?: (kind: "supervisor" | "subagent" | "fix-subagent") => number;
  wrapSupervisorTaskRun?: SupervisorBranchDeps["wrapSupervisorTaskRun"];
  wrapGateRun?: SupervisorBranchDeps["wrapGateRun"];
  /** Inject contract reader for tests. */
  readContract?: (absPath: string) => Promise<string>;
  /** Optional heuristic LLM completion (env-gated). */
  reviewerPhase2Completion?: ReviewerPhase2Completion;
}

export type ApprovalOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "reviewer_fail"; reviewer: ReviewerOutputT }
  | {
      kind: "paused_for_approval";
      reviewer: ReviewerOutputT;
      approval_prompt_paths: readonly string[];
    }
  | { kind: "cleared"; reviewer: ReviewerOutputT };

export interface RunExecuteLaneResult extends SupervisorBranchResult {
  integration: IntegrationStepResult;
  approval: ApprovalOutcome;
}

function plannedSupervisorIds(plan: PlannerOutputT): SupervisorId[] {
  const ids = new Set<SupervisorId>();
  for (const t of plan.tasks) ids.add(t.supervisor as SupervisorId);
  return [...ids];
}

function validatePlannedRepos(planned: SupervisorId[], repos: RunExecuteLaneInput["repos"]): void {
  const registered = Object.keys(repos);
  for (const sup of planned) {
    if (!repos[sup]) {
      throw new MissingManagedRepoError(sup, registered);
    }
  }
}

async function collectSupervisorReviewerSlices(
  branch: SupervisorBranchResult,
  plan: PlannerOutputT,
): Promise<SupervisorReviewerSlice[]> {
  const slices: SupervisorReviewerSlice[] = [];
  for (const s of branch.supervisors) {
    const p = s.result.output.pending_diff_path;
    if (!p || s.result.output.status !== "done") continue;
    const diffText = await readFile(p, "utf8");
    slices.push({
      supervisorId: s.supervisorId,
      stackId: s.stack,
      diffText,
      gateHistory: s.result.gate_history,
      taskSummaries: s.result.output.task_results.map((tr) => ({
        task_id: tr.task_id,
        title: plan.tasks.find((t) => t.id === tr.task_id)?.title ?? tr.task_id,
        state: tr.state,
        fix_loop_count: tr.fix_loop_count,
      })),
    });
  }
  return slices;
}

function reviewerIntegrationSlice(
  integration: IntegrationStepResult,
): ReviewerIntegrationVerdict {
  if (integration.ran !== true) return { ran: false };
  return {
    ran: true,
    recommended_action: integration.output.recommended_action,
    status: integration.output.status,
  };
}

async function appendApprovalArtifacts(
  slices: SupervisorReviewerSlice[],
  input: RunExecuteLaneInput,
  runDirResolved: string,
  reviewer: ReviewerOutputT,
  integration: IntegrationStepResult,
  auditWriter: AuditWriter,
): Promise<string[]> {
  const approvalPromptPaths: string[] = [];
  for (const sl of slices) {
    const { mdPath } = formatApprovalArtifacts({
      runId: input.ctx.run_id,
      runDir: runDirResolved,
      supervisorId: sl.supervisorId,
      diffText: sl.diffText,
      reviewer,
      plan: input.plan,
      integrationNote:
        integration.ran === true
          ? `${integration.output.status} · ${integration.output.recommended_action}`
          : undefined,
    });
    approvalPromptPaths.push(mdPath);
    auditWriter.write({
      run_id: input.ctx.run_id,
      step: "approval_prompt_written",
      agent: "approval",
      decisions: [`supervisor=${sl.supervisorId}`, `path=${mdPath}`],
      cwd: runDirResolved,
      timestamp: new Date().toISOString(),
    });
  }
  return approvalPromptPaths;
}

async function executeLaneApprovalWhenGreen(
  input: RunExecuteLaneInput,
  deps: RunExecuteLaneDeps,
  auditWriter: AuditWriter,
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
  runDirResolved: string,
  flags: Record<string, unknown>,
): Promise<RunExecuteLaneResult> {
  const slices = await collectSupervisorReviewerSlices(result, input.plan);
  if (slices.length === 0) return noPendingDiffResult(result, integration);
  let reviewer = buildDeterministicReviewer(input, integration, slices);
  writeDeterministicReviewerAudit(auditWriter, input.ctx.run_id, reviewer);
  if (reviewer.status === "fail") return reviewerFailResult(result, integration, reviewer);
  reviewer = await maybeRunPhase2Reviewer(input, deps, auditWriter, slices, reviewer);
  if (reviewer.status === "fail") return reviewerFailResult(result, integration, reviewer);
  if (flags.danger_apply === true) return clearedResult(result, integration, reviewer);
  const approvalPromptPaths = await appendApprovalArtifacts(
    slices,
    input,
    runDirResolved,
    reviewer,
    integration,
    auditWriter,
  );
  return pausedForApprovalResult(result, integration, reviewer, approvalPromptPaths);
}

function noPendingDiffResult(
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
): RunExecuteLaneResult {
  return { ...result, integration, approval: { kind: "skipped", reason: "no_pending_diff" } };
}

function buildDeterministicReviewer(
  input: RunExecuteLaneInput,
  integration: IntegrationStepResult,
  slices: SupervisorReviewerSlice[],
): ReviewerOutputT {
  return runReviewerDeterministic({
    plan: input.plan,
    supervisors: slices,
    repos: input.repos,
    integration: reviewerIntegrationSlice(integration),
  });
}

function writeDeterministicReviewerAudit(
  auditWriter: AuditWriter,
  runId: string,
  reviewer: ReviewerOutputT,
): void {
  auditWriter.write({
    run_id: runId,
    step: "reviewer_deterministic",
    agent: "reviewer",
    decisions: [
      `status=${reviewer.status}`,
      `findings=${reviewer.findings.length}`,
      `gate_fast=${reviewer.gate_summary.fast}`,
    ],
    timestamp: new Date().toISOString(),
  });
}

function reviewerFailResult(
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
  reviewer: ReviewerOutputT,
): RunExecuteLaneResult {
  return { ...result, integration, approval: { kind: "reviewer_fail", reviewer } };
}

async function maybeRunPhase2Reviewer(
  input: RunExecuteLaneInput,
  deps: RunExecuteLaneDeps,
  auditWriter: AuditWriter,
  slices: SupervisorReviewerSlice[],
  reviewer: ReviewerOutputT,
): Promise<ReviewerOutputT> {
  const phase2Enabled =
    process.env.ORCH_REVIEWER_PHASE2 === "1" ||
    process.env.ORCH_REVIEWER_PHASE2?.toLowerCase() === "true";
  if (!phase2Enabled || !deps.reviewerPhase2Completion) return reviewer;
  const nextReviewer = await runReviewerPhase2(
    { supervisors: slices, deterministic: reviewer },
    deps.reviewerPhase2Completion,
  );
  auditWriter.write({
    run_id: input.ctx.run_id,
    step: "reviewer_phase2_llm",
    agent: "reviewer",
    decisions: [
      `status=${nextReviewer.status}`,
      `findings=${nextReviewer.findings.length}`,
    ],
    timestamp: new Date().toISOString(),
  });
  return nextReviewer;
}

function clearedResult(
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
  reviewer: ReviewerOutputT,
): RunExecuteLaneResult {
  return { ...result, integration, approval: { kind: "cleared", reviewer } };
}

function pausedForApprovalResult(
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
  reviewer: ReviewerOutputT,
  approvalPromptPaths: readonly string[],
): RunExecuteLaneResult {
  return {
    ...result,
    integration,
    approval: {
      kind: "paused_for_approval",
      reviewer,
      approval_prompt_paths: approvalPromptPaths,
    },
  };
}

function executeLaneWhenAggregateNotGreen(
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
): RunExecuteLaneResult {
  return {
    ...result,
    integration,
    approval: { kind: "skipped", reason: "aggregate_not_green" },
  };
}

async function executeLaneAfterIntegration(
  input: RunExecuteLaneInput,
  deps: RunExecuteLaneDeps,
  auditWriter: AuditWriter,
  result: SupervisorBranchResult,
  integration: IntegrationStepResult,
  flags: Record<string, unknown>,
): Promise<RunExecuteLaneResult> {
  const runDirResolved = input.runDir ?? path.dirname(input.ctx.state_file_path);

  if (result.aggregateStatus !== "green") {
    return executeLaneWhenAggregateNotGreen(result, integration);
  }

  return executeLaneApprovalWhenGreen(
    input,
    deps,
    auditWriter,
    result,
    integration,
    runDirResolved,
    flags,
  );
}

async function runSupervisorBranchAndIntegration(
  input: RunExecuteLaneInput,
  deps: RunExecuteLaneDeps,
  cwds: ReturnType<typeof cwdsFromManagedRepos>,
  auditWriter: AuditWriter,
): Promise<{ result: SupervisorBranchResult; integration: IntegrationStepResult }> {
  const stackOverlays: Record<string, string> = {};
  const result = await runSupervisorBranch(
    {
      ctx: input.ctx,
      plan: input.plan,
      cwds,
      ...(input.runDir !== undefined ? { runDir: input.runDir } : {}),
      stackOverlays,
      auditWriter,
    },
    {
      subagentCompletion: deps.subagentCompletion,
      fixSubagentCompletion: deps.fixSubagentCompletion,
      ...(deps.exec ? { exec: deps.exec } : {}),
      ...(deps.estimateTokens ? { estimateTokens: deps.estimateTokens } : {}),
      ...(deps.wrapSupervisorTaskRun
        ? { wrapSupervisorTaskRun: deps.wrapSupervisorTaskRun }
        : {}),
      ...(deps.wrapGateRun ? { wrapGateRun: deps.wrapGateRun } : {}),
    },
  );

  const integration = await runIntegrationStep(
    {
      ctx: input.ctx,
      plan: input.plan,
      branchResult: result,
      cwds,
      auditWriter,
      priorContractHash: input.priorContractHash ?? null,
    },
    deps.readContract ? { readContract: deps.readContract } : {},
  );

  return { result, integration };
}

export async function runExecuteLane(
  input: RunExecuteLaneInput,
  deps: RunExecuteLaneDeps,
): Promise<RunExecuteLaneResult> {
  supervisorSpawnGuard(input.ctx.cli_flags);

  const planned = plannedSupervisorIds(input.plan);
  validatePlannedRepos(planned, input.repos);

  const cwds = cwdsFromManagedRepos(input.repos);

  // Single AuditWriter shared between supervisor + integration so
  // the chain stays linear (else prev_hash forks across writers).
  const auditWriter = new AuditWriter({
    path: input.ctx.audit_path,
    prevHash: input.ctx.prev_hash,
  });

  const flags = input.ctx.cli_flags as Record<string, unknown>;
  if (flags.danger_apply === true) {
    auditHitlEscalation(auditWriter, input.ctx.run_id, {
      signal: { kind: "danger_apply" },
      danger_reason:
        typeof flags.reason === "string" ? flags.reason : undefined,
    });
  }

  const { result, integration } = await runSupervisorBranchAndIntegration(
    input,
    deps,
    cwds,
    auditWriter,
  );

  return executeLaneAfterIntegration(
    input,
    deps,
    auditWriter,
    result,
    integration,
    flags,
  );
}
