import { z } from "zod";
import type { ReviewerOutputT } from "./schema.js";
import type { SupervisorReviewerSlice } from "./deterministic.js";

const Phase2Finding = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string().max(160),
});

const Phase2Output = z.object({
  rationale: z.string().max(200),
  findings: z.array(Phase2Finding),
});

interface ReviewerPhase2Input {
  supervisors: readonly SupervisorReviewerSlice[];
  deterministic: ReviewerOutputT;
}

export type ReviewerPhase2Completion = (prompt: string) => Promise<unknown>;

function buildPrompt(input: ReviewerPhase2Input): string {
  const lines: string[] = [
    "role=reviewer-phase2",
    "Return JSON: { rationale, findings[] }",
    "Focus: test tautologies, behavior-without-test, comments-only.",
    `deterministic_status=${input.deterministic.status}`,
    `deterministic_findings=${input.deterministic.findings.length}`,
  ];
  for (const s of input.supervisors) {
    lines.push(
      `supervisor=${s.supervisorId} tasks=${s.taskSummaries.length} diff_chars=${s.diffText.length}`,
    );
  }
  return lines.join("\n");
}

function mergeStatuses(base: ReviewerOutputT["status"], hasWarning: boolean, hasError: boolean): ReviewerOutputT["status"] {
  if (base === "fail" || hasError) return "fail";
  if (hasWarning) return "pass_with_warnings";
  return "pass";
}

export async function runReviewerPhase2(
  input: ReviewerPhase2Input,
  completion: ReviewerPhase2Completion,
): Promise<ReviewerOutputT> {
  const raw = await completion(buildPrompt(input));
  const parsed = Phase2Output.parse(raw);
  const mergedFindings = [...input.deterministic.findings, ...parsed.findings];
  const hasError = mergedFindings.some((f) => f.severity === "error");
  const hasWarning = mergedFindings.some((f) => f.severity === "warning");
  return {
    ...input.deterministic,
    status: mergeStatuses(input.deterministic.status, hasWarning, hasError),
    rationale: parsed.rationale,
    findings: mergedFindings,
  };
}

