import {
  IntegrationOutput,
  type IntegrationOutputT,
} from "./schema.js";

interface PartialOutput {
  status: IntegrationOutputT["status"];
  rationale: string;
  contract_hash: string;
  changed_endpoints?: IntegrationOutputT["changed_endpoints"];
  ui_drift?: IntegrationOutputT["ui_drift"];
  recommended_action: IntegrationOutputT["recommended_action"];
}

function finalize(p: PartialOutput): IntegrationOutputT {
  return IntegrationOutput.parse({
    status: p.status,
    rationale: p.rationale.slice(0, 200),
    contract_hash: p.contract_hash,
    changed_endpoints: p.changed_endpoints ?? [],
    ui_drift: p.ui_drift ?? [],
    recommended_action: p.recommended_action,
  });
}

export function integrationNoConsumerOutput(): IntegrationOutputT {
  return finalize({
    status: "no_consumer",
    rationale: "no cross-repo contract: consumer task did not declare consumes_contract",
    contract_hash: "",
    recommended_action: "proceed",
  });
}

export function integrationNoContractOutput(): IntegrationOutputT {
  return finalize({
    status: "no_contract",
    rationale: "no cross-repo contract: producer task did not declare contract_artifact",
    contract_hash: "",
    recommended_action: "proceed",
  });
}

function integrationCompatibleUnchanged(hash: string): IntegrationOutputT {
  return finalize({
    status: "compatible",
    rationale: "contract hash unchanged vs prior green run",
    contract_hash: hash,
    recommended_action: "proceed",
  });
}

function integrationCompatibleFirstPublish(hash: string): IntegrationOutputT {
  return finalize({
    status: "compatible",
    rationale: "first contract publish; no prior hash to diff",
    contract_hash: hash,
    recommended_action: "proceed",
  });
}

function integrationBreakingChange(
  hash: string,
  consumerPaths: readonly string[] | undefined,
): IntegrationOutputT {
  return finalize({
    status: "breaking",
    rationale:
      "contract hash changed; deterministic diff classifier defers to LLM; blocking pending review",
    contract_hash: hash,
    ui_drift: (consumerPaths ?? []).map((file) => ({
      file,
      issue: "consumer may reference changed contract endpoint(s)",
    })),
    recommended_action: "block_merge",
  });
}

export function classifyHashVersusPrior(
  hash: string,
  priorContractHash: string | null,
  consumerPaths: readonly string[] | undefined,
): IntegrationOutputT {
  if (priorContractHash !== null && priorContractHash === hash) {
    return integrationCompatibleUnchanged(hash);
  }
  if (priorContractHash === null) {
    return integrationCompatibleFirstPublish(hash);
  }
  return integrationBreakingChange(hash, consumerPaths);
}
