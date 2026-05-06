import { describe, expect, it } from "vitest";
import {
  ContractArtifactMissing,
  ContractFormatUnrecognized,
  runIntegration,
} from "../../src/agents/integration/index.js";

describe("integration agent error and guard rails", () => {
  it("throws ContractArtifactMissing when reader fails", async () => {
    await expect(
      runIntegration(
        {
          contractPath: "/missing/openapi.json",
          priorContractHash: null,
          hasConsumer: true,
        },
        {
          readContract: async () => {
            throw new Error("ENOENT");
          },
        },
      ),
    ).rejects.toBeInstanceOf(ContractArtifactMissing);
  });

  it("throws ContractFormatUnrecognized for non-.json contracts", async () => {
    await expect(
      runIntegration({
        contractPath: "/abs/api.proto",
        priorContractHash: null,
        hasConsumer: true,
      }),
    ).rejects.toBeInstanceOf(ContractFormatUnrecognized);
  });

  it("clamps rationale to <=200 chars (vault canon)", async () => {
    const out = await runIntegration({
      priorContractHash: null,
      hasConsumer: true,
    });
    expect(out.rationale.length).toBeLessThanOrEqual(200);
  });
});
