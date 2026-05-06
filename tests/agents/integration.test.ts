import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ContractArtifactMissing,
  ContractFormatUnrecognized,
  hashContract,
  runIntegration,
} from "../../src/agents/integration.js";

describe("integration agent — deterministic-only (Phase 6 MVP)", () => {
  it("returns no_consumer/proceed when no consumer task declared consumes_contract", async () => {
    const out = await runIntegration({
      contractPath: "/abs/openapi.json",
      priorContractHash: null,
      hasConsumer: false,
    });
    expect(out.status).toBe("no_consumer");
    expect(out.recommended_action).toBe("proceed");
    expect(out.contract_hash).toBe("");
  });

  it("returns no_contract/proceed when producer didn't declare contract_artifact", async () => {
    const out = await runIntegration({
      priorContractHash: null,
      hasConsumer: true,
    });
    expect(out.status).toBe("no_contract");
    expect(out.recommended_action).toBe("proceed");
  });

  it("hashes JSON contract canonically (whitespace-insensitive)", () => {
    const a = '{"openapi":"3.0","paths":{"/x":{}}}';
    const b = '{\n  "openapi": "3.0",\n  "paths": {\n    "/x": {}\n  }\n}\n';
    expect(hashContract(a, ".json")).toBe(hashContract(b, ".json"));
  });

  it("hashes raw bytes when .json is invalid (JSON.parse catch path)", () => {
    const raw = "{ not json";
    expect(hashContract(raw, ".json")).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
  });

  it("hashes raw bytes for non-.json extension", () => {
    expect(hashContract("openapi: 3", ".yaml")).toBe(
      createHash("sha256").update("openapi: 3").digest("hex"),
    );
  });

  it("returns compatible/proceed when hash matches prior green hash", async () => {
    const raw = '{"openapi":"3.0","paths":{}}';
    const prior = hashContract(raw, ".json");
    const out = await runIntegration(
      {
        contractPath: "/abs/openapi.json",
        priorContractHash: prior,
        hasConsumer: true,
      },
      { readContract: async () => raw },
    );
    expect(out.status).toBe("compatible");
    expect(out.recommended_action).toBe("proceed");
    expect(out.contract_hash).toBe(prior);
  });

  it("returns compatible/proceed on first publish (no prior hash)", async () => {
    const out = await runIntegration(
      {
        contractPath: "/abs/openapi.json",
        priorContractHash: null,
        hasConsumer: true,
      },
      { readContract: async () => '{"openapi":"3.0"}' },
    );
    expect(out.status).toBe("compatible");
    expect(out.recommended_action).toBe("proceed");
  });

  it("returns breaking/block_merge when hash changed vs prior green", async () => {
    const out = await runIntegration(
      {
        contractPath: "/abs/openapi.json",
        priorContractHash: "deadbeef".repeat(8),
        hasConsumer: true,
        consumerPaths: ["src/api/generated/index.ts"],
      },
      { readContract: async () => '{"openapi":"3.0","paths":{"/new":{}}}' },
    );
    expect(out.status).toBe("breaking");
    expect(out.recommended_action).toBe("block_merge");
    expect(out.ui_drift.length).toBe(1);
    expect(out.ui_drift[0]?.file).toBe("src/api/generated/index.ts");
  });

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

  it("clamps rationale to ≤200 chars (vault canon)", async () => {
    const out = await runIntegration({
      priorContractHash: null,
      hasConsumer: true,
    });
    expect(out.rationale.length).toBeLessThanOrEqual(200);
  });
});
