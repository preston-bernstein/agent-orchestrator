import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalize } from "../audit/jsonl.js";
import {
  IntegrationOutput,
  type IntegrationOutputT,
} from "./integration.schema.js";

/**
 * Integration agent (vault `Build/Prompts/integration.md`). Phase 6 MVP is
 * fully deterministic — hash producer's contract artifact, compare to prior
 * green hash, classify additive vs subtractive (parse subset for OpenAPI
 * JSON only).
 *
 * LLM narrative + heuristic (`ui_drift` enrichment) is intentionally
 * deferred — vault §Behavior #2 ("LLM only for narrative + heuristic") lands
 * Phase 7+ once reviewer is wired. MVP keeps this agent zero-cost (O3
 * integration role budget effectively unused) until cross-repo demand
 * justifies the LLM call.
 *
 * Refusals (vault §Refusals):
 *   - `contract artifact missing: <path>` — producer declared `contract.spec_path`
 *     but file unreadable.
 *   - `contract format unrecognized: <ext>` — only `.json` (OpenAPI) is
 *     deterministic-parseable. `.proto` / `.graphql` punt to LLM (Phase 7).
 *
 * Vault canon refs:
 *   - `Build/Prompts/integration.md` §Output, §Behavior, §Refusals
 *   - `Build/Patterns/O2-deterministic-before-llm.md` (diff-first principle)
 *   - `Build/Role x Check Matrix` (owns: contract-publish-order cross-repo
 *     facet, cross-repo-type-drift)
 */

export class ContractArtifactMissing extends Error {
  constructor(public readonly artifactPath: string) {
    super(`contract artifact missing: ${artifactPath}`);
    this.name = "ContractArtifactMissing";
  }
}

export class ContractFormatUnrecognized extends Error {
  constructor(public readonly ext: string) {
    super(
      `contract format unrecognized: ${ext} (deterministic parser supports .json OpenAPI; ` +
        `.proto / .graphql defer to Phase 7+ LLM heuristic)`,
    );
    this.name = "ContractFormatUnrecognized";
  }
}

export interface RunIntegrationInput {
  /** Absolute path to contract artifact (e.g. spring cwd + target/openapi.json). */
  contractPath?: string;
  /** Prior green-run contract hash (sha256 hex), or null if first run. */
  priorContractHash: string | null;
  /** Did any consumer task declare `consumes_contract`? */
  hasConsumer: boolean;
  /**
   * Optional consumer file paths (UI generated client); MVP only stamps
   * them into `ui_drift` when status is `breaking` w/o per-line analysis.
   */
  consumerPaths?: readonly string[];
}

export interface RunIntegrationDeps {
  /** Injection seam: file reader (tests). */
  readContract?: (absPath: string) => Promise<string>;
}

async function defaultReadContract(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

/**
 * Hash contract bytes for chain comparison. Canonicalize JSON if `.json` so
 * formatting whitespace doesn't trigger spurious `breaking`. Other formats
 * hash raw bytes.
 */
export function hashContract(raw: string, ext: string): string {
  const h = createHash("sha256");
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(raw);
      h.update(canonicalize(parsed));
    } catch {
      h.update(raw);
    }
  } else {
    h.update(raw);
  }
  return h.digest("hex");
}

/**
 * Phase 6 MVP integration agent. Path is deterministic-only:
 *   1. No consumer ⇒ `no_consumer` proceed.
 *   2. No contract path ⇒ `no_contract` proceed.
 *   3. Read contract; refuse on `ContractArtifactMissing` /
 *      `ContractFormatUnrecognized` (only `.json` supported deterministically).
 *   4. Hash. If equal to `priorContractHash` ⇒ `compatible` proceed.
 *   5. Hash differs:
 *      - First run (`priorContractHash === null`) ⇒ `compatible` proceed
 *        (initial publish; nothing to diff against).
 *      - Else ⇒ `breaking` block_merge — Phase 7 LLM enrichment classifies
 *        additive vs subtractive; MVP errs on the safe side (block).
 */
export async function runIntegration(
  input: RunIntegrationInput,
  deps: RunIntegrationDeps = {},
): Promise<IntegrationOutputT> {
  if (!input.hasConsumer) {
    return finalize({
      status: "no_consumer",
      rationale: "no cross-repo contract: consumer task did not declare consumes_contract",
      contract_hash: "",
      recommended_action: "proceed",
    });
  }
  if (!input.contractPath) {
    return finalize({
      status: "no_contract",
      rationale: "no cross-repo contract: producer task did not declare contract_artifact",
      contract_hash: "",
      recommended_action: "proceed",
    });
  }

  const ext = path.extname(input.contractPath).toLowerCase();
  if (ext !== ".json") {
    throw new ContractFormatUnrecognized(ext || "(no ext)");
  }

  const reader = deps.readContract ?? defaultReadContract;
  let raw: string;
  try {
    raw = await reader(input.contractPath);
  } catch {
    throw new ContractArtifactMissing(input.contractPath);
  }

  const hash = hashContract(raw, ext);

  if (input.priorContractHash !== null && input.priorContractHash === hash) {
    return finalize({
      status: "compatible",
      rationale: "contract hash unchanged vs prior green run",
      contract_hash: hash,
      recommended_action: "proceed",
    });
  }

  if (input.priorContractHash === null) {
    return finalize({
      status: "compatible",
      rationale: "first contract publish; no prior hash to diff",
      contract_hash: hash,
      recommended_action: "proceed",
    });
  }

  return finalize({
    status: "breaking",
    rationale:
      "contract hash changed; deterministic diff classifier defers to LLM (Phase 7); blocking pending review",
    contract_hash: hash,
    ui_drift: (input.consumerPaths ?? []).map((file) => ({
      file,
      issue: "consumer may reference changed contract endpoint(s)",
    })),
    recommended_action: "block_merge",
  });
}

interface PartialOutput {
  status: IntegrationOutputT["status"];
  rationale: string;
  contract_hash: string;
  changed_endpoints?: IntegrationOutputT["changed_endpoints"];
  ui_drift?: IntegrationOutputT["ui_drift"];
  recommended_action: IntegrationOutputT["recommended_action"];
}

function finalize(p: PartialOutput): IntegrationOutputT {
  const out = {
    status: p.status,
    rationale: p.rationale.slice(0, 200),
    contract_hash: p.contract_hash,
    changed_endpoints: p.changed_endpoints ?? [],
    ui_drift: p.ui_drift ?? [],
    recommended_action: p.recommended_action,
  };
  return IntegrationOutput.parse(out);
}
