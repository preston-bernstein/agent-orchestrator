import { globMatch } from "../llm/assemblePrompt.js";
import type { ManagedRepoMap, SupervisorId } from "../config/managedRepos.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { GateInvocation } from "../gates/types.js";
import type { ReviewerFindingT, ReviewerOutputT } from "./schema.js";
import type { ReviewerIntegrationVerdict, SupervisorReviewerSlice } from "./types.js";
import {
  codegenGlobsForSupervisor,
  restrictedGlobsForSupervisor,
  unionOwnershipGlobsForSupervisor,
} from "./deterministicOwnershipHelpers.js";
import { listUnifiedDiffRepoPaths } from "./diffPaths.js";

function sliceMsg(s: string, max = 160): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function aggregateGateSummary(
  histories: readonly GateInvocation[],
): ReviewerOutputT["gate_summary"] {
  if (histories.length === 0) {
    return { fast: "skipped", heavy: "skipped" };
  }
  const bad = histories.some((h) => h.exit !== 0 || h.oom || h.timed_out);
  return { fast: bad ? "fail" : "pass", heavy: "skipped" };
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

function forbiddenSnapshotTouches(profileFlags: readonly string[], diffText: string): string[] {
  const hits: string[] = [];
  for (const flag of profileFlags) {
    if (flag && diffText.includes(flag)) hits.push(flag);
  }
  return hits;
}

function reviewOneDiffPath(
  file: string,
  sup: SupervisorReviewerSlice,
  allowed: readonly string[],
  codegen: readonly string[],
  restricted: readonly string[],
  findings: ReviewerFindingT[],
): void {
  const inScope =
    allowed.length === 0 ? true : allowed.some((g) => globMatch(file, g));
  if (!inScope) findings.push({ severity: "error", rule: "out-of-scope-edit", file, message: sliceMsg(`path not in path_ownership_map union for ${sup.supervisorId}`) });
  if (codegen.some((g) => globMatch(file, g))) findings.push({ severity: "error", rule: "codegen-touched", file, message: sliceMsg("diff intersects codegen_paths / codegenGlobs") });
  if (restricted.some((g) => globMatch(file, g))) findings.push({ severity: "error", rule: "restricted-path", file, message: sliceMsg("diff intersects restricted_paths from _meta.md") });
}

function reviewFilesInDiff(
  paths: string[],
  sup: SupervisorReviewerSlice,
  plan: PlannerOutputT,
  repos: ManagedRepoMap,
  findings: ReviewerFindingT[],
): void {
  const allowed = unionOwnershipGlobsForSupervisor(plan, sup.supervisorId);
  const codegen = codegenGlobsForSupervisor(repos, sup.supervisorId);
  const restricted = restrictedGlobsForSupervisor(repos, sup.supervisorId);
  for (const file of paths) reviewOneDiffPath(file, sup, allowed, codegen, restricted, findings);
}

export function reviewOneSupervisor(
  sup: SupervisorReviewerSlice,
  plan: PlannerOutputT,
  repos: ManagedRepoMap,
  findings: ReviewerFindingT[],
  allHistory: GateInvocation[],
): void {
  allHistory.push(...sup.gateHistory);
  pushGateFailures(sup.gateHistory, findings);
  const paths = listUnifiedDiffRepoPaths(sup.diffText);
  reviewFilesInDiff(paths, sup, plan, repos, findings);
  const profile = repos[sup.supervisorId as SupervisorId]?.profile;
  if (!profile) return;
  const badFlags = forbiddenSnapshotTouches(profile.snapshotForbiddenFlags, sup.diffText);
  for (const flag of badFlags) {
    findings.push({ severity: "error", rule: "silencing-not-fixing", message: sliceMsg(`forbidden snapshot/test shortcut substring in patch: ${flag}`) });
  }
}

export function integrationVerdictFindings(
  integration: ReviewerIntegrationVerdict | undefined,
  findings: ReviewerFindingT[],
): void {
  if (integration?.ran !== true) return;
  const rec = integration.recommended_action;
  if (rec !== "block_merge" && rec !== "human_clarify") return;
  findings.push({
    severity: "error",
    rule: "integration-verdict",
    message: sliceMsg(`integration recommended_action=${rec} status=${integration.status ?? "?"}`),
  });
}
