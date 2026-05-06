import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSupervisorBranch } from "../../src/workflows/supervisorBranch.js";
import { runIntegrationStep } from "../../src/workflows/integrationStep.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { AuditWriter } from "../../src/audit/jsonl.js";
import { verifyChain } from "../../src/audit/verify.js";
import { hashContract } from "../../src/agents/integration/index.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import { SNAPSHOT } from "./fixtures.js";

/**
 * Phase 6 — Scenario C (cross-repo) end-to-end against mocks.
 *
 * Vault canon: `Build/Playbook.md` §Phase 6; `Build/Prompts/integration.md`;
 * `Multi-Agent Orchestration PoC#Demo scenarios` (Scenario C =
 * "API + UI feature, contract change").
 *
 * Scenario C shape:
 *   - Plan has spring-T1 (publishes `target/openapi.json`) +
 *     react-T1 (consumes same contract).
 *   - Spring runs first (canonical ordering); green ⇒ flips
 *     `gate_contract_published = true`.
 *   - React runs after; consumer task NOT blocked because contract published.
 *   - Integration agent runs against contract artifact ⇒ `compatible`
 *     (first publish, no prior hash) AND a second variant where prior hash
 *     matches ⇒ also `compatible`.
 *   - Audit chain valid; events: `supervisor_spawn` ×2, `supervisor_done` ×2,
 *     `integration_run` ×1.
 */

const tmpRoot = path.join(process.cwd(), "runs", "_test_scenario_C");

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const SCENARIO_C_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "scenario C — API publishes, UI consumes",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "user-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "add /user endpoint",
      paths: ["src/main/java/user/**", "src/test/java/user/**"],
      depends_on: [],
      contract_artifact: "target/openapi.json",
    },
    {
      id: "react-T1",
      spec_slug: "user-feature",
      repo: "react-ui",
      supervisor: "react",
      title: "consume /user",
      paths: ["src/api/generated/**", "src/feature/**"],
      depends_on: ["spring-T1"],
      consumes_contract: "target/openapi.json",
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/main/java/user/**", "src/test/java/user/**"],
    "react-T1": ["src/api/generated/**", "src/feature/**"],
  },
  refusals: [],
};

const CONTRACT_BODY = '{"openapi":"3.0","paths":{"/user":{"get":{}}}}';

interface ScenarioCRun {
  runId: string;
  priorContractHash: string | null;
}

async function runScenarioC(opts: ScenarioCRun) {
  const runDir = path.join(tmpRoot, opts.runId);
  mkdirSync(runDir, { recursive: true });
  const springCwd = path.join(tmpRoot, "_managed", opts.runId, "spring-api");
  const reactCwd = path.join(tmpRoot, "_managed", opts.runId, "react-ui");
  mkdirSync(path.join(springCwd, "target"), { recursive: true });
  mkdirSync(reactCwd, { recursive: true });
  writeFileSync(path.join(springCwd, "target", "openapi.json"), CONTRACT_BODY, "utf8");

  const ctx = initRunContext({
    run_id: opts.runId,
    started_at: "2026-05-04T09:00:00Z",
    cli_flags: { execute: true },
    expectations_snapshot: SNAPSHOT,
    audit_path: path.join(runDir, "audit.jsonl"),
    state_file_path: path.join(runDir, "state.json"),
    specs: [],
  });
  ctx.path_ownership_map = SCENARIO_C_PLAN.path_ownership_map;
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });

  const auditWriter = new AuditWriter({
    path: ctx.audit_path,
    prevHash: ctx.prev_hash,
  });

  const branchResult = await runSupervisorBranch(
    {
      ctx,
      plan: SCENARIO_C_PLAN,
      cwds: { spring: springCwd, react: reactCwd },
      runDir,
      auditWriter,
    },
    {
      subagentCompletion: async (prompt) => {
        const isSpring = prompt.text.includes("task_id: spring-T1");
        return {
          status: "patch" as const,
          rationale: "mock",
          patch: "diff --git a/x b/x\n",
          files_touched: isSpring
            ? ["src/main/java/user/User.java"]
            : ["src/api/generated/index.ts"],
          refusals: [],
          context_request: [],
        };
      },
      fixSubagentCompletion: mockFixSubagentCompletion(),
      exec: mockExec({ exit: 0, stdout: "OK" }),
    },
  );

  const integ = await runIntegrationStep({
    ctx,
    plan: SCENARIO_C_PLAN,
    branchResult,
    cwds: { spring: springCwd, react: reactCwd },
    auditWriter,
    priorContractHash: opts.priorContractHash,
  });

  return { ctx, branchResult, integ, springCwd };
}

describe("Scenario C — cross-repo (Phase 6 mock E2E)", () => {
  it("first run: spring publishes contract; react unblocks; integration compatible", async () => {
    const { ctx, branchResult, integ, springCwd } = await runScenarioC({
      runId: "scenario-C-first",
      priorContractHash: null,
    });

    expect(branchResult.aggregateStatus).toBe("green");
    expect(branchResult.gate_contract_published).toBe(true);
    expect(branchResult.contract_producers.length).toBe(1);
    expect(branchResult.contract_producers[0]?.taskId).toBe("spring-T1");
    expect(branchResult.supervisors.map((s) => s.supervisorId)).toEqual([
      "spring",
      "react",
    ]);
    expect(branchResult.supervisors[1]?.stack).toBe("ts-react-vite");

    expect(integ.ran).toBe(true);
    if (!integ.ran) throw new Error("expected integration ran");
    expect(integ.output.status).toBe("compatible");
    expect(integ.output.recommended_action).toBe("proceed");
    expect(integ.contractAbsPath).toBe(
      path.join(springCwd, "target", "openapi.json"),
    );
    expect(integ.output.contract_hash).toBe(
      hashContract(CONTRACT_BODY, ".json"),
    );

    const audit = readFileSync(ctx.audit_path, "utf8");
    const spawns = (audit.match(/"step":"supervisor_spawn"/g) ?? []).length;
    const dones = (audit.match(/"step":"supervisor_done"/g) ?? []).length;
    const blocked = (audit.match(/"step":"supervisor_blocked"/g) ?? []).length;
    const integrationRuns = (audit.match(/"step":"integration_run"/g) ?? [])
      .length;
    expect(spawns).toBe(2);
    expect(dones).toBe(2);
    expect(blocked).toBe(0);
    expect(integrationRuns).toBe(1);

    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });

  it("re-run w/ matching prior hash: integration stays compatible", async () => {
    const prior = hashContract(CONTRACT_BODY, ".json");
    const { integ } = await runScenarioC({
      runId: "scenario-C-rerun",
      priorContractHash: prior,
    });
    expect(integ.ran).toBe(true);
    if (!integ.ran) throw new Error("expected integration ran");
    expect(integ.output.status).toBe("compatible");
    expect(integ.output.contract_hash).toBe(prior);
  });
});
