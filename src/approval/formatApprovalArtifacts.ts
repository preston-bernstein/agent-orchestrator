import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildApprovalPayload,
  deriveApprovalSlices,
  filterFindingsForSupervisor,
  type ApprovalPayloadT,
} from "./approvalArtifactsPayload.js";
import type { FormatApprovalInput } from "./types.js";
import { buildApprovalMarkdown } from "./approvalArtifactsMarkdown.js";

/**
 * Writes `approval-prompt.md` + `approval-payload.json` per vault
 * `Build/Prompts/approval-formatter.md` (deterministic MVP).
 */
export function formatApprovalArtifacts(input: FormatApprovalInput): {
  mdPath: string;
  jsonPath: string;
  payload: ApprovalPayloadT;
} {
  const supDir = path.join(input.runDir, input.supervisorId);
  mkdirSync(supDir, { recursive: true });
  const slices = deriveApprovalSlices(input);
  const findings = filterFindingsForSupervisor(input.reviewer.findings, slices.diffFiles);
  const payload = buildApprovalPayload(input, findings, slices.specSlugs);
  const mdLines = buildApprovalMarkdown({
    runId: input.runId,
    runDir: input.runDir,
    supervisorId: input.supervisorId,
    reviewer: input.reviewer,
    tasks: slices.tasks,
    specSlugs: slices.specSlugs,
    findings,
    churn: slices.churn,
    ...(input.integrationNote !== undefined ? { integrationNote: input.integrationNote } : {}),
  });

  const mdPath = path.join(supDir, "approval-prompt.md");
  const jsonPath = path.join(supDir, "approval-payload.json");
  writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  return { mdPath, jsonPath, payload };
}
