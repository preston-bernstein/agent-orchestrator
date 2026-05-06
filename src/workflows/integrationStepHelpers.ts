import path from "node:path";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { SupervisorBranchResult } from "./supervisorBranch.js";
import { AuditWriter } from "../audit/jsonl.js";
import type { IntegrationSkipReason } from "./types.js";

export function consumerPaths(plan: PlannerOutputT): string[] {
  const out: string[] = [];
  for (const t of plan.tasks) if (t.consumes_contract) out.push(t.consumes_contract);
  return out;
}

export function integrationPrecheck(
  branchResult: SupervisorBranchResult,
  plan: PlannerOutputT,
): IntegrationSkipReason | null {
  if (branchResult.aggregateStatus !== "green") return "aggregate_not_green";
  const hasConsumer = plan.tasks.some((t) => Boolean(t.consumes_contract));
  if (!branchResult.gate_contract_published) {
    return hasConsumer ? "not_published" : "no_contract_no_consumer";
  }
  return hasConsumer ? null : "no_consumer";
}

export function contractPathForProducer(
  producer: NonNullable<SupervisorBranchResult["contract_producers"][number]>,
  cwds: Readonly<Record<string, string>>,
): string | null {
  const producerCwd = cwds[producer.supervisorId];
  if (!producerCwd) return null;
  return path.isAbsolute(producer.contractArtifact)
    ? producer.contractArtifact
    : path.join(producerCwd, producer.contractArtifact);
}

export function auditIntegrationSkipped(
  audit: AuditWriter,
  runId: string,
  reason: IntegrationSkipReason,
): void {
  audit.write({
    run_id: runId,
    step: "integration_skipped",
    agent: "integration",
    decisions: [`reason=${reason}`],
    timestamp: new Date().toISOString(),
  });
}

export function integrationRunDecisionFields(input: {
  status: string;
  recommended: string;
  contractAbsPath: string;
  producer: NonNullable<SupervisorBranchResult["contract_producers"][number]>;
}): string[] {
  return [
    `status=${input.status}`,
    `recommended=${input.recommended}`,
    `contract=${path.basename(input.contractAbsPath)}`,
    `producer=${input.producer.supervisorId}/${input.producer.taskId}`,
  ];
}
