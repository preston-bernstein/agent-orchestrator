import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIntegrationStep } from "../../src/workflows/integrationStep.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import type { SupervisorBranchResult } from "../../src/workflows/supervisorBranch.js";
import { SNAPSHOT } from "./fixtures.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_integration_step_skip");
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
  status: "ready",
  rationale: "spring publishes; react consumes",
  tasks: [
    { id: "spring-T1", spec_slug: "x", repo: "spring-api", supervisor: "spring", title: "publish", paths: ["src/main/java/auth/**"], depends_on: [], contract_artifact: "target/openapi.json" },
    { id: "react-T1", spec_slug: "x", repo: "react-ui", supervisor: "react", title: "consume", paths: ["src/api/generated/**"], depends_on: ["spring-T1"], consumes_contract: "target/openapi.json" },
  ],
  path_ownership_map: {},
  refusals: [],
};
const REACT_ONLY_PLAN: PlannerOutputT = { status: "ready", rationale: "react alone", tasks: [{ id: "react-T1", spec_slug: "x", repo: "react-ui", supervisor: "react", title: "internal change", paths: ["src/feature/**"], depends_on: [] }], path_ownership_map: {}, refusals: [] };
const greenBranch: SupervisorBranchResult = { supervisors: [], aggregateStatus: "green", gate_contract_published: true, contract_producers: [{ supervisorId: "spring", taskId: "spring-T1", contractArtifact: "target/openapi.json" }] };

describe("runIntegrationStep skip reasons", () => {
  it("skips w/ aggregate_not_green when supervisorBranch returned non-green", async () => {
    const ctx = makeRun("integ-skip-red");
    const out = await runIntegrationStep({ ctx, plan: CROSS_REPO_PLAN, branchResult: { ...greenBranch, aggregateStatus: "red" }, cwds: { spring: "/fake/spring" } });
    expect(out.ran).toBe(false);
    if (out.ran) throw new Error("expected ran:false");
    expect(out.reason).toBe("aggregate_not_green");
    expect(readFileSync(ctx.audit_path, "utf8")).toMatch(/"step":"integration_skipped".+reason=aggregate_not_green/);
  });

  it("skips w/ no_consumer when plan has no consumes_contract task", async () => {
    const ctx = makeRun("integ-skip-no-consumer");
    const out = await runIntegrationStep({ ctx, plan: REACT_ONLY_PLAN, branchResult: { ...greenBranch, gate_contract_published: true, contract_producers: [] }, cwds: { react: "/fake/react" } });
    expect(out.ran).toBe(false);
    if (out.ran) throw new Error("expected ran:false");
    expect(out.reason).toBe("no_consumer");
  });

  it("skips w/ no_contract_no_consumer when nothing was published + no consumer", async () => {
    const ctx = makeRun("integ-skip-nothing");
    const out = await runIntegrationStep({ ctx, plan: REACT_ONLY_PLAN, branchResult: { ...greenBranch, gate_contract_published: false, contract_producers: [] }, cwds: { react: "/fake/react" } });
    expect(out.ran).toBe(false);
    if (out.ran) throw new Error("expected ran:false");
    expect(out.reason).toBe("no_contract_no_consumer");
  });
});
