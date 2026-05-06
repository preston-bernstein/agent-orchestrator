import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonicalize } from "../../audit/jsonl.js";
import type { IntegrationOutputT } from "./schema.js";
import {
  classifyHashVersusPrior,
  integrationNoConsumerOutput,
  integrationNoContractOutput,
} from "./outcome.js";

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
        `.proto / .graphql defer to heuristic LLM review)`,
    );
    this.name = "ContractFormatUnrecognized";
  }
}

interface RunIntegrationInput {
  contractPath?: string;
  priorContractHash: string | null;
  hasConsumer: boolean;
  consumerPaths?: readonly string[];
}

interface RunIntegrationDeps {
  readContract?: (absPath: string) => Promise<string>;
}

async function defaultReadContract(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

async function readContractOrThrow(
  contractPath: string,
  reader: (absPath: string) => Promise<string>,
): Promise<string> {
  try {
    return await reader(contractPath);
  } catch {
    throw new ContractArtifactMissing(contractPath);
  }
}

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

export async function runIntegration(
  input: RunIntegrationInput,
  deps: RunIntegrationDeps = {},
): Promise<IntegrationOutputT> {
  if (!input.hasConsumer) {
    return integrationNoConsumerOutput();
  }
  if (!input.contractPath) {
    return integrationNoContractOutput();
  }

  const ext = path.extname(input.contractPath).toLowerCase();
  if (ext !== ".json") {
    throw new ContractFormatUnrecognized(ext || "(no ext)");
  }

  const reader = deps.readContract ?? defaultReadContract;
  const raw = await readContractOrThrow(input.contractPath, reader);
  const hash = hashContract(raw, ext);

  return classifyHashVersusPrior(hash, input.priorContractHash, input.consumerPaths);
}
