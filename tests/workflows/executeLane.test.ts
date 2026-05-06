import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MissingManagedRepoError,
  runExecuteLane,
} from "../../src/workflows/executeLane.js";
import { SupervisorNotWiredError } from "../../src/workflows/plannerBranch.js";
import { mockSubagentCompletion } from "../../src/agents/subagent/index.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { loadManagedRepos } from "../../src/config/managedRepos.js";
import { SNAPSHOT, SCENARIO_A_PLAN, OVERLAP_PLAN } from "./fixtures.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_execute_lane");

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


describe("runExecuteLane — managed repos + reviewer handoff", () => {
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
    expect(out.approval.kind).toBe("paused_for_approval");
    if (out.approval.kind !== "paused_for_approval") throw new Error("approval");
    expect(out.approval.approval_prompt_paths.length).toBe(1);
    expect(readFileSync(out.approval.approval_prompt_paths[0]!, "utf8")).toMatch(
      /^# Approval — spring/s,
    );
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"supervisor_spawn"/);
    expect(audit).toMatch(/"step":"reviewer_deterministic"/);
    expect(audit).toMatch(/"step":"approval_prompt_written"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});

describe("runExecuteLane — hitl escalation", () => {
  it("emits hitl_escalation when cli_flags.danger_apply", async () => {
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
    expect(out.approval.kind).toBe("cleared");
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
});

describe("runExecuteLane — execution guard refusals", () => {
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
});

describe("runExecuteLane — integration skip wiring", () => {
  it("Scenario A → integration_skipped no_consumer", async () => {
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
    expect(out.approval.kind).toBe("paused_for_approval");
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(
      /"step":"integration_skipped".+reason=no_contract_no_consumer/,
    );
    expect(audit).toMatch(/"step":"reviewer_deterministic"/);
    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});

describe("runExecuteLane — reviewer skip when aggregate/path issues", () => {
  it("skips reviewer when aggregate not green (path overlap)", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-overlap",
      cliFlags: { execute: true },
    });
    ctx.path_ownership_map = OVERLAP_PLAN.path_ownership_map;
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    const out = await runExecuteLane(
      { ctx, plan: OVERLAP_PLAN, repos, runDir },
      {
        subagentCompletion: mockSubagentCompletion(),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0 }),
      },
    );
    expect(out.aggregateStatus).toBe("needs_human_clarify");
    expect(out.approval.kind).toBe("skipped");
    if (out.approval.kind !== "skipped") throw new Error("approval");
    expect(out.approval.reason).toBe("aggregate_not_green");
  });
});

describe("runExecuteLane — approval gates", () => {
  it("skips approval when supervisor did not receive runDir (no pending.diff)", async () => {
    const { ctx } = makeRun({
      runId: "exec-lane-nodiff",
      cliFlags: { execute: true },
    });
    const repos = await loadManagedRepos({
      envRaw: "spring-api:/fake/spring-api",
      readMeta: async () => SPRING_META,
    });
    const out = await runExecuteLane(
      { ctx, plan: SCENARIO_A_PLAN, repos },
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
    expect(out.approval.kind).toBe("skipped");
    if (out.approval.kind !== "skipped") throw new Error("approval");
    expect(out.approval.reason).toBe("no_pending_diff");
  });

  it("reviewer_fail when unified diff touches paths outside ownership", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-lane-rev-fail",
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
          [
            "diff --git a/src/main/java/auth/A.java b/src/main/java/auth/A.java\n",
            "+++ b/src/main/java/auth/A.java\n",
            "+ok\n",
            "diff --git a/src/billing/X.java b/src/billing/X.java\n",
            "+++ b/src/billing/X.java\n",
            "+x\n",
          ].join(""),
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );
    expect(out.aggregateStatus).toBe("green");
    expect(out.approval.kind).toBe("reviewer_fail");
    if (out.approval.kind !== "reviewer_fail") throw new Error("approval");
    expect(out.approval.reviewer.status).toBe("fail");
    expect(
      out.approval.reviewer.findings.some((f) => f.rule === "out-of-scope-edit"),
    ).toBe(true);
  });
});
