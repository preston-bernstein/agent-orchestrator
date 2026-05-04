import path from "node:path";
import { readFile } from "node:fs/promises";
import { AuditWriter } from "../audit/jsonl.js";
import {
  ContractArtifactMissing,
  ContractFormatUnrecognized,
  runIntegration,
} from "../agents/integration.js";
import type { IntegrationOutputT } from "../agents/integration.schema.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { PlannerOutputT } from "../agents/planner.schema.js";
import type { SupervisorBranchResult } from "./supervisorBranch.js";

/**
 * Phase 6 cross-repo integration step. Runs AFTER `runSupervisorBranch`;
 * compares producer's contract artifact (declared by green spring task)
 * against prior green-run hash. Vault canon: `Build/Prompts/integration.md`.
 *
 * Skip rules (audit `integration_skipped` w/ explicit reason):
 *   - `aggregateStatus !== 'green'` — supervisors red/blocked; integration
 *     irrelevant until they recover.
 *   - `gate_contract_published === false` AND no consumer task exists ⇒
 *     `no_contract_no_consumer` (purely intra-repo run).
 *   - `gate_contract_published === false` AND consumer exists ⇒ would
 *     normally have hit `block_for_contract` upstream; defensive `not_published`.
 *   - No consumer task in plan ⇒ `no_consumer` (producer-only repo run).
 *
 * Run rules:
 *   - Both producer + consumer tasks present in plan AND aggregate green AND
 *     contract published ⇒ run integration agent against first producer's
 *     `contract_artifact` resolved relative to producer cwd. Audit
 *     `integration_run` w/ `decisions: status=…, recommended=…`.
 *
 * Refusals propagate as thrown errors (`ContractArtifactMissing` /
 * `ContractFormatUnrecognized`); caller decides whether to halt the run.
 */

export type IntegrationSkipReason =
  | "aggregate_not_green"
  | "no_consumer"
  | "no_contract_no_consumer"
  | "not_published";

export interface IntegrationStepInput {
  ctx: OrchestratorContextT;
  plan: PlannerOutputT;
  branchResult: SupervisorBranchResult;
  /** Map supervisor id → managed-repo cwd (for resolving contract path). */
  cwds: Readonly<Record<string, string>>;
  /** Inject writer when caller already opened audit. */
  auditWriter?: AuditWriter;
  /** Prior green-run contract hash (sha256 hex), or null if first run. */
  priorContractHash?: string | null;
}

export interface IntegrationStepDeps {
  /** Injection seam: file reader. Defaults to fs.readFile (utf8). */
  readContract?: (absPath: string) => Promise<string>;
}

export type IntegrationStepResult =
  | { ran: true; output: IntegrationOutputT; contractAbsPath: string }
  | { ran: false; reason: IntegrationSkipReason };

async function defaultReadContract(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

function hasConsumerTask(plan: PlannerOutputT): boolean {
  return plan.tasks.some((t) => Boolean(t.consumes_contract));
}

function consumerPaths(plan: PlannerOutputT): string[] {
  const out: string[] = [];
  for (const t of plan.tasks) {
    if (t.consumes_contract) out.push(t.consumes_contract);
  }
  return out;
}

export async function runIntegrationStep(
  input: IntegrationStepInput,
  deps: IntegrationStepDeps = {},
): Promise<IntegrationStepResult> {
  const { ctx, plan, branchResult, cwds } = input;
  const audit =
    input.auditWriter ??
    new AuditWriter({ path: ctx.audit_path, prevHash: ctx.prev_hash });
  const reader = deps.readContract ?? defaultReadContract;

  const skip = (reason: IntegrationSkipReason): IntegrationStepResult => {
    audit.write({
      run_id: ctx.run_id,
      step: "integration_skipped",
      agent: "integration",
      decisions: [`reason=${reason}`],
      timestamp: new Date().toISOString(),
    });
    return { ran: false, reason };
  };

  if (branchResult.aggregateStatus !== "green") {
    return skip("aggregate_not_green");
  }

  const consumer = hasConsumerTask(plan);
  if (!branchResult.gate_contract_published) {
    return skip(consumer ? "not_published" : "no_contract_no_consumer");
  }
  if (!consumer) {
    return skip("no_consumer");
  }

  const producer = branchResult.contract_producers[0];
  if (!producer) {
    // Defensive: gate_contract_published true but list empty — should not happen.
    return skip("not_published");
  }
  const producerCwd = cwds[producer.supervisorId];
  if (!producerCwd) {
    // Defensive: caller must register cwds[producer.supervisorId]; treat as not published.
    return skip("not_published");
  }
  const contractAbsPath = path.isAbsolute(producer.contractArtifact)
    ? producer.contractArtifact
    : path.join(producerCwd, producer.contractArtifact);

  const output = await runIntegration(
    {
      contractPath: contractAbsPath,
      priorContractHash: input.priorContractHash ?? null,
      hasConsumer: true,
      consumerPaths: consumerPaths(plan),
    },
    { readContract: reader },
  );

  audit.write({
    run_id: ctx.run_id,
    step: "integration_run",
    agent: "integration",
    decisions: [
      `status=${output.status}`,
      `recommended=${output.recommended_action}`,
      `contract=${path.basename(contractAbsPath)}`,
      `producer=${producer.supervisorId}/${producer.taskId}`,
    ],
    timestamp: new Date().toISOString(),
  });

  return { ran: true, output, contractAbsPath };
}

export {
  ContractArtifactMissing as IntegrationContractArtifactMissing,
  ContractFormatUnrecognized as IntegrationContractFormatUnrecognized,
};
