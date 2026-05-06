import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIntegrationStep } from "../../src/workflows/integrationStep.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { hashContract } from "../../src/agents/integration/index.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import type { SupervisorBranchResult } from "../../src/workflows/supervisorBranch.js";
import { SNAPSHOT } from "./fixtures.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_integration_step_run");
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function makeRun(runId: string) {
  const runDir = path.join(tmpRoot, runId);
  mkdirSync(runDir, { recursive: true });
  const ctx = initRunContext({ run_id: runId, started_at: "2026-05-04T09:00:00Z", cli_flags: { execute: true }, expectations_snapshot: SNAPSHOT, audit_path: path.join(runDir, "audit.jsonl"), state_file_path: path.join(runDir, "state.json"), specs: [] });
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });
  return ctx;
}

const CROSS_REPO_PLAN: PlannerOutputT = {
  status: "ready", rationale: "spring publishes; react consumes",
  tasks: [
    { id: "spring-T1", spec_slug: "x", repo: "spring-api", supervisor: "spring", title: "publish", paths: ["src/main/java/auth/**"], depends_on: [], contract_artifact: "target/openapi.json" },
    { id: "react-T1", spec_slug: "x", repo: "react-ui", supervisor: "react", title: "consume", paths: ["src/api/generated/**"], depends_on: ["spring-T1"], consumes_contract: "target/openapi.json" },
  ],
  path_ownership_map: {}, refusals: [],
};
const greenBranch: SupervisorBranchResult = { supervisors: [], aggregateStatus: "green", gate_contract_published: true, contract_producers: [{ supervisorId: "spring", taskId: "spring-T1", contractArtifact: "target/openapi.json" }] };

describe("runIntegrationStep — Phase 6 cross-repo", () => {
  it("runs integration agent + audits integration_run when producer+consumer green", async () => {
    const ctx = makeRun("integ-run");
    const out = await runIntegrationStep({ ctx, plan: CROSS_REPO_PLAN, branchResult: greenBranch, cwds: { spring: "/fake/spring", react: "/fake/react" }, priorContractHash: null }, { readContract: async () => '{"openapi":"3.0"}' });
    expect(out.ran).toBe(true);
    if (!out.ran) throw new Error("expected ran:true");
    expect(out.output.status).toBe("compatible");
    expect(out.output.recommended_action).toBe("proceed");
    expect(out.contractAbsPath).toBe("/fake/spring/target/openapi.json");
    expect(readFileSync(ctx.audit_path, "utf8")).toMatch(/"step":"integration_run"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });

  it("flags breaking when contract hash differs vs prior green hash", async () => {
    const ctx = makeRun("integ-breaking");
    const out = await runIntegrationStep({ ctx, plan: CROSS_REPO_PLAN, branchResult: greenBranch, cwds: { spring: "/fake/spring", react: "/fake/react" }, priorContractHash: hashContract('{"openapi":"3.0"}', ".json") }, { readContract: async () => '{"openapi":"3.0","paths":{"/new":{}}}' });
    if (!out.ran) throw new Error("expected ran:true");
    expect(out.output.status).toBe("breaking");
    expect(out.output.recommended_action).toBe("block_merge");
    expect(out.output.ui_drift.length).toBeGreaterThan(0);
  });
});
