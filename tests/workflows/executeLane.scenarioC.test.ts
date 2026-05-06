import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExecuteLane } from "../../src/workflows/executeLane.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { loadManagedRepos } from "../../src/config/managedRepos.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import { SNAPSHOT } from "./fixtures.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_execute_lane_scenario_c");

const SPRING_META = `---
stack: java-spring
package_manager: maven
codegen_paths: []
generated_markers:
  - "@Generated"
contract:
  format: openapi-3
  spec_path: "target/openapi.json"
restricted_paths:
  - "pom.xml"
---
`;

const REACT_META = `---
stack: ts-react-vite
package_manager: pnpm
codegen_paths:
  - "src/api/generated/**"
generated_markers:
  - "// @generated"
contract:
  format: openapi-3
  spec_path: "src/api/generated/index.ts"
restricted_paths:
  - "vite.config.ts"
---
`;

function makeRun(opts: { runId: string; cliFlags: Record<string, unknown> }) {
  const runDir = path.join(tmpRoot, opts.runId);
  mkdirSync(runDir, { recursive: true });
  const ctx = initRunContext({
    run_id: opts.runId,
    started_at: "2026-05-04T09:00:00Z",
    cli_flags: opts.cliFlags,
    expectations_snapshot: SNAPSHOT,
    audit_path: path.join(runDir, "audit.jsonl"),
    state_file_path: path.join(runDir, "state.json"),
    specs: [],
  });
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });
  return { ctx, runDir };
}

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const SCENARIO_C_PLAN_FOR_LANE: PlannerOutputT = {
  status: "ready",
  rationale: "scenario C minimal — spring publishes, react consumes",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "user-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "publish",
      paths: ["src/main/java/user/**"],
      depends_on: [],
      contract_artifact: "target/openapi.json",
    },
    {
      id: "react-T1",
      spec_slug: "user-feature",
      repo: "react-ui",
      supervisor: "react",
      title: "consume",
      paths: ["src/feature/**"],
      depends_on: ["spring-T1"],
      consumes_contract: "target/openapi.json",
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/main/java/user/**"],
    "react-T1": ["src/feature/**"],
  },
  refusals: [],
};

describe("runExecuteLane — cross-repo integration wiring (Scenario C)", () => {
  it("loads spring + react managed repos; integration_run on green chain", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-scenario-C",
      cliFlags: { execute: true },
    });
    ctx.path_ownership_map = SCENARIO_C_PLAN_FOR_LANE.path_ownership_map;
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api,react-ui:/fake/react-ui",
      readMeta: async (p) => (p.includes("spring-api") ? SPRING_META : REACT_META),
    });
    const out = await runExecuteLane(
      { ctx, plan: SCENARIO_C_PLAN_FOR_LANE, repos, runDir, priorContractHash: null },
      {
        subagentCompletion: async (prompt) => {
          const isSpring = prompt.text.includes("task_id: spring-T1");
          return {
            status: "patch" as const,
            rationale: "mock",
            patch: isSpring
              ? "diff --git a/src/main/java/user/User.java b/src/main/java/user/User.java\n+++ b/src/main/java/user/User.java\n@@ -0,0 +1 @@\n+class User {}\n"
              : "diff --git a/src/feature/User.tsx b/src/feature/User.tsx\n+++ b/src/feature/User.tsx\n@@ -0,0 +1 @@\n+export function User() { return null }\n",
            files_touched: isSpring ? ["src/main/java/user/User.java"] : ["src/feature/User.tsx"],
            refusals: [],
            context_request: [],
          };
        },
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "OK" }),
        readContract: async () => '{"openapi":"3.0","paths":{"/user":{}}}',
      },
    );
    expect(out.aggregateStatus).toBe("green");
    expect(out.gate_contract_published).toBe(true);
    expect(out.supervisors.map((s) => s.supervisorId)).toEqual(["spring", "react"]);
    expect(out.integration.ran).toBe(true);
    if (!out.integration.ran) throw new Error("expected ran:true");
    expect(out.integration.output.status).toBe("compatible");
    expect(out.integration.output.recommended_action).toBe("proceed");
    expect(out.approval.kind).toBe("paused_for_approval");
    if (out.approval.kind !== "paused_for_approval") throw new Error("approval");
    expect(out.approval.approval_prompt_paths).toHaveLength(2);
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"integration_run"/);
    expect(audit).toMatch(/"step":"approval_prompt_written"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});
