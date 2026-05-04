import { globMatch } from "../llm/assemblePrompt.js";
import type { ManagedRepoMap, SupervisorId } from "../config/managedRepos.js";
import type { PlannerOutputT } from "../agents/planner.schema.js";
import type { GateInvocation } from "../gates/runQuality.js";
import { ReviewerOutput, type ReviewerFindingT, type ReviewerOutputT } from "./schema.js";
import { listUnifiedDiffRepoPaths } from "./diffPaths.js";

export interface SupervisorReviewerSlice {
  supervisorId: string;
  stackId: string;
  diffText: string;
  gateHistory: readonly GateInvocation[];
  taskSummaries: readonly {
    task_id: string;
    title: string;
    state: string;
    fix_loop_count: number;
  }[];
}

/** Narrow integration verdict for reviewer (avoid importing workflow layer). */
export interface ReviewerIntegrationVerdict {
  ran: boolean;
  recommended_action?: string;
  status?: string;
}

export interface ReviewerDeterministicInput {
  plan: PlannerOutputT;
  supervisors: readonly SupervisorReviewerSlice[];
  repos: ManagedRepoMap;
  integration?: ReviewerIntegrationVerdict;
}

function unionOwnershipGlobsForSupervisor(
  plan: PlannerOutputT,
  supervisorId: string,
): string[] {
  const globs: string[] = [];
  const pom = plan.path_ownership_map ?? {};
  for (const t of plan.tasks) {
    if (t.supervisor !== supervisorId) continue;
    const g = pom[t.id];
    if (g) globs.push(...g);
  }
  return [...new Set(globs)];
}

function codegenGlobsForSupervisor(repos: ManagedRepoMap, supervisorId: string): string[] {
  const entry = repos[supervisorId as SupervisorId];
  if (!entry) return [];
  const fromMeta = entry.meta.codegen_paths ?? [];
  const fromProfile = entry.profile.codegenGlobs ?? [];
  return [...new Set([...fromMeta, ...fromProfile])];
}

function restrictedGlobsForSupervisor(repos: ManagedRepoMap, supervisorId: string): string[] {
  return repos[supervisorId as SupervisorId]?.meta.restricted_paths ?? [];
}

function aggregateGateSummary(
  histories: readonly GateInvocation[],
): ReviewerOutputT["gate_summary"] {
  if (histories.length === 0) {
    return { fast: "skipped", heavy: "skipped" };
  }
  const bad = histories.some((h) => h.exit !== 0 || h.oom || h.timed_out);
  return {
    fast: bad ? "fail" : "pass",
    heavy: "skipped",
  };
}

function pushGateFailures(history: readonly GateInvocation[], findings: ReviewerFindingT[]): void {
  for (const h of history) {
    if (h.exit !== 0 || h.oom || h.timed_out) {
      findings.push({
        severity: "error",
        rule: "gate-failed",
        message: sliceMsg(
          `exit=${h.exit} oom=${Boolean(h.oom)} timed_out=${Boolean(h.timed_out)} kind=${h.kind} stack=${h.stack}`,
        ),
      });
    }
  }
}

function sliceMsg(s: string, max = 160): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** Scan patch text for forbidden snapshot / skip-test style flags (vault reviewer overlay). */
function forbiddenSnapshotTouches(profileFlags: readonly string[], diffText: string): string[] {
  const hits: string[] = [];
  for (const flag of profileFlags) {
    if (flag && diffText.includes(flag)) hits.push(flag);
  }
  return hits;
}

/**
 * Deterministic reviewer (vault `Build/Prompts/reviewer.md` §Phase 1 only).
 * No LLM — `pass_with_warnings` reserved for future heuristic slice.
 */
export function runReviewerDeterministic(input: ReviewerDeterministicInput): ReviewerOutputT {
  const findings: ReviewerFindingT[] = [];
  const allHistory: GateInvocation[] = [];

  if (input.integration?.ran === true) {
    const rec = input.integration.recommended_action;
    if (rec === "block_merge" || rec === "human_clarify") {
      findings.push({
        severity: "error",
        rule: "integration-verdict",
        message: sliceMsg(
          `integration recommended_action=${rec} status=${input.integration.status ?? "?"}`,
        ),
      });
    }
  }

  for (const sup of input.supervisors) {
    allHistory.push(...sup.gateHistory);
    pushGateFailures(sup.gateHistory, findings);

    const paths = listUnifiedDiffRepoPaths(sup.diffText);
    const allowed = unionOwnershipGlobsForSupervisor(input.plan, sup.supervisorId);
    const codegen = codegenGlobsForSupervisor(input.repos, sup.supervisorId);
    const restricted = restrictedGlobsForSupervisor(input.repos, sup.supervisorId);
    const profile = input.repos[sup.supervisorId as SupervisorId]?.profile;

    for (const file of paths) {
      const inScope =
        allowed.length === 0 ? true : allowed.some((g) => globMatch(file, g));
      if (!inScope) {
        findings.push({
          severity: "error",
          rule: "out-of-scope-edit",
          file,
          message: sliceMsg(`path not in path_ownership_map union for ${sup.supervisorId}`),
        });
      }
      if (codegen.some((g) => globMatch(file, g))) {
        findings.push({
          severity: "error",
          rule: "codegen-touched",
          file,
          message: sliceMsg("diff intersects codegen_paths / codegenGlobs"),
        });
      }
      if (restricted.some((g) => globMatch(file, g))) {
        findings.push({
          severity: "error",
          rule: "restricted-path",
          file,
          message: sliceMsg("diff intersects restricted_paths from _meta.md"),
        });
      }
    }

    if (profile) {
      const badFlags = forbiddenSnapshotTouches(profile.snapshotForbiddenFlags, sup.diffText);
      for (const flag of badFlags) {
        findings.push({
          severity: "error",
          rule: "silencing-not-fixing",
          message: sliceMsg(`forbidden snapshot/test shortcut substring in patch: ${flag}`),
        });
      }
    }
  }

  const gate_summary = aggregateGateSummary(allHistory);
  const hasError = findings.some((f) => f.severity === "error");
  const status: ReviewerOutputT["status"] = hasError ? "fail" : "pass";
  const rationale = hasError
    ? "deterministic reviewer: errors present — no approval until resolved"
    : "deterministic reviewer: gates + scope + codegen/restricted scans clean";

  return ReviewerOutput.parse({
    status,
    rationale,
    findings,
    gate_summary,
  });
}
