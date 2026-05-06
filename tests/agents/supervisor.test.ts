import { describe, expect, it } from "vitest";
import {
  CycleAbortError,
  findPathOverlap,
  runSupervisor,
} from "../../src/agents/supervisor/index.js";
import { mockSubagentCompletion } from "../../src/agents/subagent/index.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec, type GateExecResult } from "../../src/gates/runQuality.js";
import { javaSpringProfile } from "../../src/stacks/javaSpring.js";
import type { PlannerTaskT } from "../../src/agents/planner/schema.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";

const SNAPSHOT = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

function makeCtx() {
  return initRunContext({
    run_id: "supervisor-test",
    started_at: "2026-05-04T09:00:00Z",
    cli_flags: { execute: true },
    expectations_snapshot: SNAPSHOT,
    audit_path: "/tmp/audit.jsonl",
    state_file_path: "/tmp/state.json",
    specs: [],
  });
}

const TASK_T1: PlannerTaskT = {
  id: "spring-T1",
  spec_slug: "auth-feature",
  repo: "spring-api",
  supervisor: "spring",
  title: "add auth endpoint",
  paths: ["src/main/java/auth/**", "src/test/java/auth/**"],
  depends_on: [],
};
const TASK_T2_OVERLAP: PlannerTaskT = {
  ...TASK_T1,
  id: "spring-T2",
  paths: ["src/main/java/auth/**"],
};

describe("findPathOverlap (vault supervisor-base §Behavior #1)", () => {
  it("returns null when no shared globs", () => {
    expect(
      findPathOverlap([
        TASK_T1,
        { ...TASK_T1, id: "T2", paths: ["src/main/java/billing/**"] },
      ]),
    ).toBeNull();
  });

  it("flags overlap on identical glob", () => {
    const o = findPathOverlap([TASK_T1, TASK_T2_OVERLAP]);
    expect(o).toEqual({
      a: "spring-T1",
      b: "spring-T2",
      path: "src/main/java/auth/**",
    });
  });
});

describe("runSupervisor — happy path (gate green first try)", () => {
  it("returns done + hand_off_to_reviewer + green task_results", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
      },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }),
      },
    );
    expect(out.output.status).toBe("done");
    expect(out.output.next_action).toBe("hand_off_to_reviewer");
    expect(out.output.task_results[0]?.state).toBe("green");
    expect(out.output.task_results[0]?.fix_loop_count).toBe(0);
    expect(out.gate_history.length).toBe(1);
  });
});

describe("runSupervisor — fix-loop converges then green", () => {
  it("retries gate after fix-subagent patch; tracks attempt_counter", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    let gateCall = 0;
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
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
        exec: async (
          cmd: readonly string[],
          opts: { cwd: string; timeoutMs?: number; env?: Readonly<Record<string, string>> },
        ): Promise<GateExecResult> => {
          gateCall++;
          if (gateCall === 1) {
            return {
              exit: 1,
              stdout: "",
              stderr: "FAIL: NPE at A.java:42",
            };
          }
          void cmd;
          void opts;
          return { exit: 0, stdout: "BUILD SUCCESS", stderr: "" };
        },
      },
    );
    expect(out.output.status).toBe("done");
    expect(out.output.task_results[0]?.fix_loop_count).toBe(1);
    expect(out.attempt_counter["spring-T1"]).toBe(1);
    expect(out.gate_history.length).toBe(2);
    expect(out.tokens_delta["fix-subagent"]).toBeGreaterThan(0);
  });
});

describe("runSupervisor — fix-loop budget exhaustion (edge 10)", () => {
  it("halts task w/ budget_exhausted after max_fix_loops", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    ctx.max_fix_loops = 2;
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
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
        exec: mockExec({ exit: 1, stderr: "always failing" }),
      },
    );
    expect(out.output.status).toBe("budget_exhausted");
    expect(out.output.next_action).toBe("halt");
    expect(out.output.task_results[0]?.state).toBe("red");
    expect(out.attempt_counter["spring-T1"]).toBe(3);
    expect(out.output.fix_targets.length).toBe(1);
  });
});

describe("runSupervisor — subagent no_change (skipped)", () => {
  it("marks task skipped when subagent returns no_change", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
      },
      {
        subagentCompletion: async () => ({
          status: "no_change",
          rationale: "nothing to do",
          patch: "",
          files_touched: [],
          refusals: [],
          context_request: [],
        }),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0 }),
      },
    );
    expect(out.output.status).toBe("done");
    expect(out.output.task_results[0]?.state).toBe("skipped");
    expect(out.gate_history.length).toBe(0);
  });
});

describe("runSupervisor — fix-subagent refuses mid loop", () => {
  it("needs_human_clarify when fix-subagent returns refused", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    let gateCalls = 0;
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
      },
      {
        subagentCompletion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/...\n",
          ["src/main/java/auth/A.java"],
        ),
        fixSubagentCompletion: async () => ({
          status: "refused",
          rationale: "cannot fix",
          patch: "",
          files_touched: [],
          refusals: ["no"],
          context_request: [],
        }),
        exec: async () => {
          gateCalls++;
          return gateCalls === 1
            ? { exit: 1, stdout: "", stderr: "FAIL" }
            : { exit: 0, stdout: "", stderr: "" };
        },
      },
    );
    expect(out.output.status).toBe("needs_human_clarify");
    expect(out.output.fix_targets.length).toBeGreaterThan(0);
  });
});

describe("runSupervisor — path overlap refusal", () => {
  it("returns needs_human_clarify before any subagent call", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = {
      "spring-T1": TASK_T1.paths,
      "spring-T2": TASK_T2_OVERLAP.paths,
    };
    let subCalls = 0;
    const out = await runSupervisor(
      {
        tasks: [TASK_T1, TASK_T2_OVERLAP],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
      },
      {
        subagentCompletion: async () => {
          subCalls++;
          return mockSubagentCompletion()({} as never);
        },
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0 }),
      },
    );
    expect(out.output.status).toBe("needs_human_clarify");
    expect(out.output.next_action).toBe("halt");
    expect(subCalls).toBe(0);
    expect(out.gate_history.length).toBe(0);
  });
});

describe("runSupervisor — O3 supervisor budget cap", () => {
  it("returns budget_exhausted at boot when supervisor budget already spent", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    ctx.tokens_budget.supervisor = 500;
    ctx.tokens_spent = { supervisor: 500 };
    let subCalls = 0;
    const out = await runSupervisor(
      {
        tasks: [TASK_T1],
        ctx,
        profile: javaSpringProfile,
        cwd: "/tmp/spring-api",
        supervisorId: "spring",
      },
      {
        subagentCompletion: async () => {
          subCalls++;
          return mockSubagentCompletion()({} as never);
        },
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0 }),
      },
    );
    expect(out.output.status).toBe("budget_exhausted");
    expect(subCalls).toBe(0);
  });
});

describe("runSupervisor — cycle guard (edge 32)", () => {
  it("throws CycleAbortError when visited.length exceeds graph_depth_cap", async () => {
    const ctx = makeCtx();
    ctx.path_ownership_map = { "spring-T1": TASK_T1.paths };
    ctx.graph_depth_cap = 2;
    await expect(
      runSupervisor(
        {
          tasks: [TASK_T1],
          ctx,
          profile: javaSpringProfile,
          cwd: "/tmp/spring-api",
          supervisorId: "spring",
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
          exec: mockExec({ exit: 1, stderr: "always failing" }),
        },
      ),
    ).rejects.toBeInstanceOf(CycleAbortError);
  });
});
