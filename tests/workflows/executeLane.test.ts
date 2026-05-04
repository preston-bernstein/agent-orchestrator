import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MissingManagedRepoError,
  runExecuteLane,
} from "../../src/workflows/executeLane.js";
import { SupervisorNotWiredError } from "../../src/workflows/plannerBranch.js";
import { mockSubagentCompletion } from "../../src/agents/subagent.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { loadManagedRepos } from "../../src/config/managedRepos.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_execute_lane");

const SNAPSHOT = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

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

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function makeRun(opts: {
  runId: string;
  cliFlags: Record<string, unknown>;
}) {
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
  ctx.path_ownership_map = {
    "spring-T1": ["src/main/java/auth/**", "src/test/java/auth/**"],
  };
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });
  return { ctx, runDir };
}

const SCENARIO_A_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "scenario A — single spring task, API-only",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "auth-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "add auth endpoint",
      paths: ["src/main/java/auth/**", "src/test/java/auth/**"],
      depends_on: [],
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/main/java/auth/**", "src/test/java/auth/**"],
  },
  refusals: [],
};

describe("runExecuteLane — Phase 5 closeout (cli execute lane wiring)", () => {
  it("happy: resolves cwds from managed repos + delegates to supervisorBranch", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-happy",
      cliFlags: { execute: true },
    });
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    const out = await runExecuteLane(
      { ctx, plan: SCENARIO_A_PLAN, repos, runDir },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );
    expect(out.aggregateStatus).toBe("green");
    const sup = out.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.supervisorId).toBe("spring");
    expect(sup.result.output.status).toBe("done");
    expect(out.phase7.kind).toBe("paused_for_approval");
    if (out.phase7.kind !== "paused_for_approval") throw new Error("phase7");
    expect(out.phase7.approval_prompt_paths.length).toBe(1);
    expect(readFileSync(out.phase7.approval_prompt_paths[0]!, "utf8")).toMatch(
      /^# Approval — spring/s,
    );
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"supervisor_spawn"/);
    expect(audit).toMatch(/"step":"reviewer_deterministic"/);
    expect(audit).toMatch(/"step":"approval_prompt_written"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });

  it("emits hitl_escalation when cli_flags.danger_apply (Phase 7)", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-danger",
      cliFlags: {
        execute: true,
        danger_apply: true,
        reason: "break-glass test fixture",
      },
    });
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    const out = await runExecuteLane(
      { ctx, plan: SCENARIO_A_PLAN, repos, runDir },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );
    expect(out.aggregateStatus).toBe("green");
    expect(out.phase7.kind).toBe("cleared");
    const audit = readFileSync(ctx.audit_path, "utf8");
    const hitlIdx = audit.indexOf('"step":"hitl_escalation"');
    const spawnIdx = audit.indexOf('"step":"supervisor_spawn"');
    expect(hitlIdx).toBeGreaterThanOrEqual(0);
    expect(spawnIdx).toBeGreaterThan(hitlIdx);
    expect(audit).toMatch(/hitl_category=C1/);
    expect(audit).toMatch(/"step":"reviewer_deterministic"/);
    expect(audit).not.toMatch(/"step":"approval_prompt_written"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });

  it("refuses (SupervisorNotWiredError) when ctx.cli_flags.execute !== true", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-no-flag",
      cliFlags: { dry_plan: true },
    });
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    await expect(
      runExecuteLane(
        { ctx, plan: SCENARIO_A_PLAN, repos, runDir },
        {
          subagentCompletion: mockSubagentCompletion(),
          fixSubagentCompletion: mockFixSubagentCompletion(),
          exec: mockExec({ exit: 0 }),
        },
      ),
    ).rejects.toBeInstanceOf(SupervisorNotWiredError);
  });

  it("refuses (MissingManagedRepoError) when plan references unregistered supervisor", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-missing",
      cliFlags: { execute: true },
    });
    const repos = await loadManagedRepos({
      envRaw: "",
    });
    await expect(
      runExecuteLane(
        { ctx, plan: SCENARIO_A_PLAN, repos, runDir },
        {
          subagentCompletion: mockSubagentCompletion(),
          fixSubagentCompletion: mockFixSubagentCompletion(),
          exec: mockExec({ exit: 0 }),
        },
      ),
    ).rejects.toBeInstanceOf(MissingManagedRepoError);
  });

  it("Scenario A → integration_skipped no_consumer (Phase 6 wiring)", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-integ-skip",
      cliFlags: { execute: true },
    });
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    const out = await runExecuteLane(
      { ctx, plan: SCENARIO_A_PLAN, repos, runDir },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );
    expect(out.aggregateStatus).toBe("green");
    expect(out.integration.ran).toBe(false);
    if (out.integration.ran) throw new Error("expected ran:false");
    // Scenario A plan has no contract_artifact + no consumes_contract.
    expect(out.integration.reason).toBe("no_contract_no_consumer");
    expect(out.phase7.kind).toBe("paused_for_approval");
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(
      /"step":"integration_skipped".+reason=no_contract_no_consumer/,
    );
    expect(audit).toMatch(/"step":"reviewer_deterministic"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
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

describe("runExecuteLane — Phase 6 cross-repo integration wiring (Scenario C)", () => {
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
      {
        ctx,
        plan: SCENARIO_C_PLAN_FOR_LANE,
        repos,
        runDir,
        priorContractHash: null,
      },
      {
        subagentCompletion: async (prompt) => {
          const isSpring = prompt.text.includes("task_id: spring-T1");
          return {
            status: "patch" as const,
            rationale: "mock",
            patch: isSpring
              ? [
                  "diff --git a/src/main/java/user/User.java b/src/main/java/user/User.java\n",
                  "+++ b/src/main/java/user/User.java\n",
                  "@@ -0,0 +1 @@\n",
                  "+class User {}\n",
                ].join("")
              : [
                  "diff --git a/src/feature/User.tsx b/src/feature/User.tsx\n",
                  "+++ b/src/feature/User.tsx\n",
                  "@@ -0,0 +1 @@\n",
                  "+export function User() { return null }\n",
                ].join(""),
            files_touched: isSpring
              ? ["src/main/java/user/User.java"]
              : ["src/feature/User.tsx"],
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
    expect(out.supervisors.map((s) => s.supervisorId)).toEqual([
      "spring",
      "react",
    ]);
    expect(out.integration.ran).toBe(true);
    if (!out.integration.ran) throw new Error("expected ran:true");
    expect(out.integration.output.status).toBe("compatible");
    expect(out.integration.output.recommended_action).toBe("proceed");

    expect(out.phase7.kind).toBe("paused_for_approval");
    if (out.phase7.kind !== "paused_for_approval") throw new Error("phase7");
    expect(out.phase7.approval_prompt_paths).toHaveLength(2);

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"integration_run"/);
    expect(audit).toMatch(/"step":"approval_prompt_written"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});
