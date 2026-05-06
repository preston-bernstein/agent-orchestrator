import { readFile } from "node:fs/promises";
import { AuditWriter } from "../audit/jsonl.js";
import { runIntegration } from "../agents/integration/index.js";
import type { IntegrationOutputT } from "../agents/integration/schema.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { SupervisorBranchResult } from "./supervisorBranch.js";
import type { IntegrationSkipReason } from "./types.js";
import {
  auditIntegrationSkipped,
  consumerPaths,
  contractPathForProducer,
  integrationPrecheck,
  integrationRunDecisionFields,
} from "./integrationStepHelpers.js";

interface IntegrationStepInput {
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

interface IntegrationStepDeps {
  /** Injection seam: file reader. Defaults to fs.readFile (utf8). */
  readContract?: (absPath: string) => Promise<string>;
}

export type IntegrationStepResult =
  | { ran: true; output: IntegrationOutputT; contractAbsPath: string }
  | { ran: false; reason: IntegrationSkipReason };

async function defaultReadContract(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

async function runIntegrationWithAudit(
  ctx: OrchestratorContextT,
  audit: AuditWriter,
  contractAbsPath: string,
  producer: NonNullable<SupervisorBranchResult["contract_producers"][number]>,
  plan: PlannerOutputT,
  priorContractHash: string | null | undefined,
  reader: (absPath: string) => Promise<string>,
): Promise<IntegrationStepResult> {
  const output = await runIntegration(
    {
      contractPath: contractAbsPath,
      priorContractHash: priorContractHash ?? null,
      hasConsumer: true,
      consumerPaths: consumerPaths(plan),
    },
    { readContract: reader },
  );

  audit.write({
    run_id: ctx.run_id,
    step: "integration_run",
    agent: "integration",
    decisions: integrationRunDecisionFields({
      status: output.status,
      recommended: output.recommended_action,
      contractAbsPath,
      producer,
    }),
    timestamp: new Date().toISOString(),
  });

  return { ran: true, output, contractAbsPath };
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

  const early = integrationPrecheck(branchResult, plan);
  if (early !== null) {
    auditIntegrationSkipped(audit, ctx.run_id, early);
    return { ran: false, reason: early };
  }

  const producer = branchResult.contract_producers[0];
  if (!producer) {
    auditIntegrationSkipped(audit, ctx.run_id, "not_published");
    return { ran: false, reason: "not_published" };
  }
  const contractAbsPath = contractPathForProducer(producer, cwds);
  if (!contractAbsPath) {
    auditIntegrationSkipped(audit, ctx.run_id, "not_published");
    return { ran: false, reason: "not_published" };
  }

  return runIntegrationWithAudit(
    ctx,
    audit,
    contractAbsPath,
    producer,
    plan,
    input.priorContractHash,
    reader,
  );
}
