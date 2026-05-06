import type { GateInvocation } from "../gates/types.js";
import { ReviewerOutput, type ReviewerFindingT, type ReviewerOutputT } from "./schema.js";
import type { ReviewerDeterministicInput } from "./types.js";
import {
  aggregateGateSummary,
  integrationVerdictFindings,
  reviewOneSupervisor,
} from "./deterministicHelpers.js";

export type {
  ReviewerDeterministicInput,
  ReviewerIntegrationVerdict,
  SupervisorReviewerSlice,
} from "./types.js";

/**
 * Deterministic reviewer (vault `Build/Prompts/reviewer.md` §Phase 1 only).
 * No LLM — `pass_with_warnings` reserved for future heuristic slice.
 */
export function runReviewerDeterministic(input: ReviewerDeterministicInput): ReviewerOutputT {
  const findings: ReviewerFindingT[] = [];
  const allHistory: GateInvocation[] = [];

  integrationVerdictFindings(input.integration, findings);

  for (const sup of input.supervisors) {
    reviewOneSupervisor(sup, input.plan, input.repos, findings, allHistory);
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
