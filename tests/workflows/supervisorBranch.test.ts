import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  UnknownSupervisorCwd,
  compareSupervisorIds,
  runSupervisorBranch,
} from "../../src/workflows/supervisorBranch.js";
import { mockSubagentCompletion } from "../../src/agents/subagent.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_supervisor_branch");

const SNAPSHOT = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function makeRun(opts: { runId: string }) {
  const runDir = path.join(tmpRoot, opts.runId);
  mkdirSync(runDir, { recursive: true });
  const repoCwd = path.join(tmpRoot, "_managed", "spring-api");
  mkdirSync(repoCwd, { recursive: true });
  const ctx = initRunContext({
    run_id: opts.runId,
    started_at: "2026-05-04T09:00:00Z",
    cli_flags: { execute: true },
    expectations_snapshot: SNAPSHOT,
    audit_path: path.join(runDir, "audit.jsonl"),
    state_file_path: path.join(runDir, "state.json"),
    specs: [],
  });
  ctx.path_ownership_map = {
    "spring-T1": ["src/main/java/auth/**", "src/test/java/auth/**"],
  };
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });
  return { ctx, runDir, repoCwd };
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

describe("runSupervisorBranch — Scenario A (java-spring, API-only, mock TF + mock gate)", () => {
  it("walks plan → supervisor → subagent → gate green; emits pending.diff + audit chain valid", async () => {
    const { ctx, runDir, repoCwd } = makeRun({ runId: "scenario-A-happy" });
    const out = await runSupervisorBranch(
      {
        ctx,
        plan: SCENARIO_A_PLAN,
        cwds: { spring: repoCwd },
        runDir,
      },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/src/main/java/auth/A.java\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );

    expect(out.aggregateStatus).toBe("green");
    expect(out.supervisors.length).toBe(1);
    const sup = out.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.supervisorId).toBe("spring");
    expect(sup.stack).toBe("java-spring");
    expect(sup.result.output.status).toBe("done");
    expect(sup.result.output.pending_diff_path).toBeDefined();
    expect(existsSync(sup.result.output.pending_diff_path as string)).toBe(true);

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"supervisor_spawn"/);
    expect(audit).toMatch(/"step":"gate_invocation"/);
    expect(audit).toMatch(/"step":"supervisor_done"/);

    const verify = verifyChain(ctx.audit_path);
    expect(verify.valid).toBe(true);
  });

  it("respects max_fix_loops cap; aggregate = budget_exhausted", async () => {
    const { ctx, runDir, repoCwd } = makeRun({ runId: "scenario-A-cap" });
    ctx.max_fix_loops = 2;
    const out = await runSupervisorBranch(
      {
        ctx,
        plan: SCENARIO_A_PLAN,
        cwds: { spring: repoCwd },
        runDir,
      },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n+x\n",
          ["src/main/java/auth/A.java"],
        ),
        exec: mockExec({ exit: 1, stderr: "perpetual NPE" }),
      },
    );
    expect(out.aggregateStatus).toBe("budget_exhausted");
    const sup = out.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.result.output.status).toBe("budget_exhausted");
    expect(sup.result.output.fix_targets.length).toBe(1);
    expect(sup.result.attempt_counter["spring-T1"]).toBe(3);

    const audit = readFileSync(ctx.audit_path, "utf8");
    const gateInvocations = (audit.match(/"step":"gate_invocation"/g) ?? [])
      .length;
    expect(gateInvocations).toBe(3);
  });

  it("throws UnknownSupervisorCwd when no cwd registered for supervisor id", async () => {
    const { ctx, runDir } = makeRun({ runId: "scenario-A-nocwd" });
    await expect(
      runSupervisorBranch(
        {
          ctx,
          plan: SCENARIO_A_PLAN,
          cwds: {},
          runDir,
        },
        {
          subagentCompletion: mockSubagentCompletion(),
          fixSubagentCompletion: mockFixSubagentCompletion(),
          exec: mockExec({ exit: 0 }),
        },
      ),
    ).rejects.toBeInstanceOf(UnknownSupervisorCwd);
  });
});

describe("runSupervisorBranch — fix-loop converges then green", () => {
  it("first gate red, fix-subagent patches, second gate green", async () => {
    const { ctx, runDir, repoCwd } = makeRun({ runId: "scenario-A-fixloop" });
    let gateCall = 0;
    const out = await runSupervisorBranch(
      {
        ctx,
        plan: SCENARIO_A_PLAN,
        cwds: { spring: repoCwd },
        runDir,
      },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n+fix\n",
          ["src/main/java/auth/A.java"],
        ),
        exec: async () => {
          gateCall++;
          return gateCall === 1
            ? { exit: 1, stdout: "", stderr: "FAIL line 42" }
            : { exit: 0, stdout: "BUILD SUCCESS", stderr: "" };
        },
      },
    );
    expect(out.aggregateStatus).toBe("green");
    const sup = out.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.result.output.status).toBe("done");
    expect(sup.result.output.task_results[0]?.fix_loop_count).toBe(1);
    expect(sup.result.gate_history.length).toBe(2);
  });
});

describe("compareSupervisorIds — Phase 6 canonical ordering (edge 1 API-first)", () => {
  it("orders spring before react before orch", () => {
    expect(compareSupervisorIds("spring", "react")).toBeLessThan(0);
    expect(compareSupervisorIds("react", "orch")).toBeLessThan(0);
    expect(compareSupervisorIds("spring", "orch")).toBeLessThan(0);
  });
  it("places unknown ids after known", () => {
    expect(compareSupervisorIds("spring", "data")).toBeLessThan(0);
    expect(compareSupervisorIds("data", "react")).toBeGreaterThan(0);
  });
  it("alpha-sorts pairs of unknown ids", () => {
    expect(compareSupervisorIds("data", "infra")).toBeLessThan(0);
  });
});

describe("runSupervisorBranch — Phase 6 API-first edge lock", () => {
  it("blocks react supervisor when consumer task w/o publish (no spring task)", async () => {
    const { ctx, runDir, repoCwd } = makeRun({ runId: "edgelock-no-publish" });
    const reactCwd = path.join(repoCwd, "..", "react-ui");
    mkdirSync(reactCwd, { recursive: true });
    const plan: PlannerOutputT = {
      status: "ready",
      rationale: "react consumer alone — should block",
      tasks: [
        {
          id: "react-T1",
          spec_slug: "ui-feat",
          repo: "react-ui",
          supervisor: "react",
          title: "consume new endpoint",
          paths: ["src/feature/**"],
          depends_on: [],
          consumes_contract: "target/openapi.json",
        },
      ],
      path_ownership_map: {
        "react-T1": ["src/feature/**"],
      },
      refusals: [],
    };
    ctx.path_ownership_map = plan.path_ownership_map;

    const out = await runSupervisorBranch(
      { ctx, plan, cwds: { react: reactCwd }, runDir },
      {
        subagentCompletion: mockSubagentCompletion(),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0 }),
      },
    );

    expect(out.aggregateStatus).toBe("blocked_on_contract");
    expect(out.gate_contract_published).toBe(false);
    const sup = out.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.result.output.status).toBe("block_for_contract");
    expect(sup.result.output.next_action).toBe("wait_for_contract");
    expect(sup.result.gate_history.length).toBe(0);

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"supervisor_blocked"/);
    expect(audit).not.toMatch(/"step":"gate_invocation"/);
    const verify = verifyChain(ctx.audit_path);
    expect(verify.valid).toBe(true);
  });

  it("ordering — runs spring before react regardless of plan task order", async () => {
    const { ctx, runDir, repoCwd } = makeRun({ runId: "edgelock-ordering" });
    const reactCwd = path.join(repoCwd, "..", "react-ui");
    mkdirSync(reactCwd, { recursive: true });
    const plan: PlannerOutputT = {
      status: "ready",
      rationale: "react listed first; spring second; runner must reorder",
      tasks: [
        {
          id: "react-T1",
          spec_slug: "x-feat",
          repo: "react-ui",
          supervisor: "react",
          title: "consume",
          paths: ["src/feature/**"],
          depends_on: ["spring-T1"],
          consumes_contract: "target/openapi.json",
        },
        {
          id: "spring-T1",
          spec_slug: "x-feat",
          repo: "spring-api",
          supervisor: "spring",
          title: "publish",
          paths: ["src/main/java/auth/**"],
          depends_on: [],
          contract_artifact: "target/openapi.json",
        },
      ],
      path_ownership_map: {
        "react-T1": ["src/feature/**"],
        "spring-T1": ["src/main/java/auth/**"],
      },
      refusals: [],
    };
    ctx.path_ownership_map = plan.path_ownership_map;

    const out = await runSupervisorBranch(
      {
        ctx,
        plan,
        cwds: { spring: repoCwd, react: reactCwd },
        runDir,
      },
      {
        subagentCompletion: async (prompt) => {
          // Echo a per-task patch + files_touched matching task.paths so
          // `enforceFilesTouched` accepts. Discriminate on `task_id:` line
          // (depends_on field also mentions spring-T1 → can't substring match).
          const isSpring = prompt.text.includes("task_id: spring-T1");
          return {
            status: "patch" as const,
            rationale: "mock",
            patch: "diff --git a/x b/x\n",
            files_touched: isSpring
              ? ["src/main/java/auth/A.java"]
              : ["src/feature/x.ts"],
            refusals: [],
            context_request: [],
          };
        },
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "OK" }),
      },
    );

    expect(out.aggregateStatus).toBe("green");
    expect(out.supervisors.map((s) => s.supervisorId)).toEqual([
      "spring",
      "react",
    ]);
    expect(out.gate_contract_published).toBe(true);
    expect(out.contract_producers.length).toBe(1);
    expect(out.contract_producers[0]?.taskId).toBe("spring-T1");
    expect(out.contract_producers[0]?.contractArtifact).toBe(
      "target/openapi.json",
    );
  });
});
