import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseCli } from "./decisionCli.js";
import { inngest } from "../inngest/client.js";
import type { DecisionInput } from "./types.js";

export type { DecisionInput };

const DecisionSchema = z.object({
  run_id: z.string(),
  supervisor: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
  note: z.string().optional(),
  diff_hash: z.string(),
  timestamp: z.string(),
});
type DecisionT = z.infer<typeof DecisionSchema>;

const PayloadSchema = z.object({
  run_id: z.string(),
  supervisor: z.string(),
  diff_hash: z.string(),
});

function runRoot(runId: string, runsDir?: string): string {
  return path.join(path.resolve(runsDir ?? "runs"), runId);
}

function approvalDir(runId: string, supervisor: string, runsDir?: string): string {
  return path.join(runRoot(runId, runsDir), supervisor);
}

function readPayload(runId: string, supervisor: string, runsDir?: string) {
  const p = path.join(approvalDir(runId, supervisor, runsDir), "approval-payload.json");
  const raw = readFileSync(p, "utf8");
  return PayloadSchema.parse(JSON.parse(raw));
}

function decisionPath(runId: string, supervisor: string, runsDir?: string): string {
  return path.join(approvalDir(runId, supervisor, runsDir), "approval-decision.json");
}

export function writeApprovalDecision(input: DecisionInput): DecisionT {
  const payload = readPayload(input.runId, input.supervisor, input.runsDir);
  mkdirSync(approvalDir(input.runId, input.supervisor, input.runsDir), { recursive: true });
  const decision = DecisionSchema.parse({
    run_id: input.runId,
    supervisor: input.supervisor,
    approved: input.approved,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.note ? { note: input.note } : {}),
    diff_hash: payload.diff_hash,
    timestamp: new Date().toISOString(),
  });
  writeFileSync(decisionPath(input.runId, input.supervisor, input.runsDir), JSON.stringify(decision, null, 2));
  return decision;
}

function approvalEventName(supervisor: string): "orch/approve.spring" | "orch/approve.react" | null {
  if (supervisor === "spring") return "orch/approve.spring";
  if (supervisor === "react") return "orch/approve.react";
  return null;
}

export async function sendApprovalEvent(decision: DecisionT): Promise<void> {
  if (!decision.approved) return;
  const eventName = approvalEventName(decision.supervisor);
  if (!eventName) return;
  await inngest.send({
    name: eventName,
    data: {
      runId: decision.run_id,
      diffHash: decision.diff_hash,
      approver: process.env.USER ?? "cli-approver",
      ...(decision.reason ? { reason: decision.reason } : {}),
    },
  });
}

export interface WaitForDecisionInput {
  runId: string;
  supervisor: string;
  timeoutMs?: number;
  pollMs?: number;
  runsDir?: string;
}

export async function waitForApprovalDecision(input: WaitForDecisionInput): Promise<DecisionT | null> {
  const timeoutMs = input.timeoutMs ?? 24 * 60 * 60 * 1000;
  const pollMs = input.pollMs ?? 1000;
  const start = Date.now();
  const p = decisionPath(input.runId, input.supervisor, input.runsDir);
  while (Date.now() - start < timeoutMs) {
    if (existsSync(p)) {
      return DecisionSchema.parse(JSON.parse(readFileSync(p, "utf8")));
    }
    await delay(pollMs);
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = writeApprovalDecision(parseCli(process.argv.slice(2)));
  sendApprovalEvent(d)
    .then(() => console.log(JSON.stringify(d, null, 2)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
