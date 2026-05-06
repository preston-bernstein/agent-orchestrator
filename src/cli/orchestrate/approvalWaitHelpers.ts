import path from "node:path";
import { readFileSync } from "node:fs";
import { waitForApprovalDecision } from "../../approval/wait.js";
import { AuditWriter, ZERO_HASH } from "../../audit/jsonl.js";

export function parseSupervisorFromPromptPath(p: string): string {
  return path.basename(path.dirname(p));
}

export function readAuditTailHash(auditPath: string): string {
  try {
    const raw = readFileSync(auditPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return ZERO_HASH;
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as { hash?: string };
    return typeof last.hash === "string" && last.hash.length > 0 ? last.hash : ZERO_HASH;
  } catch {
    return ZERO_HASH;
  }
}

function writeTimeoutDecision(audit: AuditWriter, runId: string, sup: string): void {
  audit.write({
    run_id: runId,
    step: "approval_decision",
    agent: "approval",
    decisions: [`supervisor=${sup}`, "decision=timeout"],
    timestamp: new Date().toISOString(),
  });
}

function writeResolvedDecision(
  audit: AuditWriter,
  runId: string,
  sup: string,
  approved: boolean,
  reason?: string,
): void {
  audit.write({
    run_id: runId,
    step: "approval_decision",
    agent: "approval",
    decisions: [
      `supervisor=${sup}`,
      `approved=${approved}`,
      ...(reason ? [`reason=${reason.slice(0, 200)}`] : []),
    ],
    timestamp: new Date().toISOString(),
  });
}

export async function pollAllSupervisorDecisions(input: {
  runId: string;
  supervisors: string[];
  timeoutMs: number;
  runsDir: string;
  audit: AuditWriter;
}): Promise<{ approved: number; rejected: number; timedOut: number }> {
  let approved = 0;
  let rejected = 0;
  let timedOut = 0;
  for (const sup of input.supervisors) {
    const decision = await waitForApprovalDecision({
      runId: input.runId,
      supervisor: sup,
      timeoutMs: input.timeoutMs,
      runsDir: input.runsDir,
    });
    if (!decision) {
      timedOut++;
      writeTimeoutDecision(input.audit, input.runId, sup);
      continue;
    }
    if (decision.approved) approved++;
    else rejected++;
    writeResolvedDecision(
      input.audit,
      input.runId,
      sup,
      decision.approved,
      decision.reason,
    );
  }
  return { approved, rejected, timedOut };
}
