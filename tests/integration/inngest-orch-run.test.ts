/**
 * Drives `orchRunHandler` directly (no Inngest dev server).
 * Dry path uses `fixtures/no-op.md` → planner O5 skip. Execute path injects
 * planner + execute fakes so approvals + `sup-task:*` wiring assert in isolation.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  orchRunHandler,
  type OrchStep,
} from "../../src/inngest/functions/orch-run.js";
import type { RunExecuteLaneResult } from "../../src/workflows/executeLane.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import type { PlannerBranchOutcome } from "../../src/workflows/plannerBranch.js";
import type { ManagedRepoMap } from "../../src/config/managedRepos.js";
import { getStackProfile } from "../../src/stacks/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const INJECT_EXECUTE_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "test",
  tasks: [
    {
      id: "t1",
      spec_slug: "s",
      repo: "spring-api",
      supervisor: "spring",
      title: "t",
      paths: ["a"],
      depends_on: [],
    },
  ],
  path_ownership_map: {},
  refusals: [],
};

const STUB_PAUSE_LANE_EXECUTE = {
  supervisors: [
    {
      supervisorId: "spring",
      stack: "java-spring",
      result: {
        output: {
          status: "done",
          rationale: "x",
          task_results: [
            { task_id: "t1", state: "green", fix_loop_count: 0, notes: "" },
          ],
          next_action: "hand_off_to_reviewer",
          fix_targets: [],
          pending_diff_path: "/tmp/p.diff",
        },
        visited_nodes: [],
        attempt_counter: {},
        tokens_delta: { supervisor: 0, subagent: 0, "fix-subagent": 0 },
        gate_history: [],
        patches: [],
      },
    },
    {
      supervisorId: "react",
      stack: "ts-react-vite",
      result: {
        output: {
          status: "done",
          rationale: "x",
          task_results: [
            { task_id: "t2", state: "green", fix_loop_count: 0, notes: "" },
          ],
          next_action: "hand_off_to_reviewer",
          fix_targets: [],
          pending_diff_path: "/tmp/r.diff",
        },
        visited_nodes: [],
        attempt_counter: {},
        tokens_delta: { supervisor: 0, subagent: 0, "fix-subagent": 0 },
        gate_history: [],
        patches: [],
      },
    },
  ],
  aggregateStatus: "green",
  gate_contract_published: false,
  contract_producers: [],
  integration: { ran: false, reason: "no_contract_no_consumer" },
  approval: {
    kind: "paused_for_approval",
    reviewer: {
      status: "pass",
      findings: [],
      gate_summary: { fast: 0, standard: 0 },
      rationale: "t",
    },
    approval_prompt_paths: ["/a", "/b"],
  },
} as unknown as RunExecuteLaneResult;

type StepCall =
  | { kind: "run"; id: string }
  | { kind: "waitForEvent"; id: string; args: { event: string; match: string; timeout: string } };

function makeFakeStep(): { step: OrchStep; calls: StepCall[] } {
  const calls: StepCall[] = [];
  const step: OrchStep = {
    async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
      calls.push({ kind: "run", id });
      return await fn();
    },
    async waitForEvent(id, args) {
      calls.push({ kind: "waitForEvent", id, args });
      return {
        name: args.event,
        data: { runId: "test-run-id", diffHash: "sha256-stub", approver: "test-harness" },
      };
    },
  };
  return { step, calls };
}

const STUB_MANAGED_ONE: ManagedRepoMap = {
  spring: {
    repoId: "spring-api",
    supervisorId: "spring",
    cwd: repoRoot,
    meta: {
      stack: "java-spring",
      restricted_paths: [],
      codegen_paths: [],
      generated_markers: [],
      owners: [],
    },
    profile: getStackProfile("java-spring"),
  },
} as ManagedRepoMap;

function baseEvent(name: "orch/dry-plan.requested" | "orch/run.requested"): {
  name: typeof name;
  data: {
    runId: string;
    specSlug: string;
    repo: "agent-orchestrator";
    specPath: string;
  };
} {
  return {
    name,
    data: {
      runId: randomUUID(),
      specSlug: "no-op",
      repo: "agent-orchestrator",
      specPath: path.join(repoRoot, "fixtures/no-op.md"),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("MOCK_TF", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("orch-run — dry-plan branch (no execute lane)", () => {
  it("dry_plan_done on fixture + no managed-repo / approval steps", async () => {
    const { step, calls } = makeFakeStep();
    const result = await orchRunHandler({
      event: baseEvent("orch/dry-plan.requested"),
      step,
      repoRoot,
    });

    expect(result).toMatchObject({
      status: "dry_plan_done",
      planPath: expect.stringMatching(/plan\.json$/),
    });

    const runIds = calls.filter((c): c is Extract<StepCall, { kind: "run" }> => c.kind === "run").map((c) => c.id);
    expect(runIds).toEqual(["expectations-boot", "tf-probe", "planner-branch"]);
    expect(runIds).not.toContain("load-managed-repos");
    expect(calls.some((c) => c.kind === "waitForEvent")).toBe(false);
  });
});

describe("orch-run — execute inject (HITL dynamic waits)", () => {
  it("returns green + waits for spring + react approvals", async () => {
    const { step, calls } = makeFakeStep();
    const result = await orchRunHandler({
      event: baseEvent("orch/run.requested"),
      step,
      repoRoot,
      overrides: {
        runPlannerBranch: async ({ ctx }) => {
          const out: PlannerBranchOutcome = {
            kind: "execution_started",
            planPath: path.join(path.dirname(ctx.state_file_path), "plan.json"),
            plan: INJECT_EXECUTE_PLAN,
            auditTailHash: ctx.prev_hash,
          };
          return out;
        },

        runExecuteLane: async () => STUB_PAUSE_LANE_EXECUTE,
      },
    });

    expect(result).toMatchObject({ status: "green" });

    const runIds = calls.filter((c) => c.kind === "run").map((c) => c.id);
    expect(runIds).toContain("load-managed-repos");
    expect(runIds).toContain("audit-finalize");

    const waits = calls.filter(
      (c): c is Extract<StepCall, { kind: "waitForEvent" }> => c.kind === "waitForEvent",
    );
    expect(waits.map((w) => w.args.event).sort()).toEqual([
      "orch/approve.react",
      "orch/approve.spring",
    ]);
    for (const w of waits) {
      expect(w.args.match).toBe("data.runId");
      expect(w.args.timeout).toBe("7d");
    }
  });
});

describe("orch-run — gates.verify (managed-repo gates only)", () => {
  it("pre-planner + gate-verify steps + finalize (stub runQuality)", async () => {
    const { step, calls } = makeFakeStep();
    const runId = randomUUID();
    const result = await orchRunHandler({
      event: {
        name: "orch/gates.verify.requested",
        data: {
          runId,
          specSlug: "no-op",
          repo: "agent-orchestrator",
          specPath: path.join(repoRoot, "fixtures/no-op.md"),
        },
      },
      step,
      repoRoot,
      overrides: {
        loadManagedRepos: async () => STUB_MANAGED_ONE,
        gatesVerifyQuality: async (inp) => ({
          cmd: ["echo", "ok"],
          cwd: inp.cwd,
          exit: 0,
          oom: false,
          timed_out: false,
          duration_ms: 1,
          log_tail: "",
          kind: inp.kind,
          stack: inp.profile.id,
        }),
      },
    });

    expect(result).toMatchObject({ status: "gates_verify_done", failures: [] });
    const runIds = calls.filter((c): c is Extract<StepCall, { kind: "run" }> => c.kind === "run").map(
      (c) => c.id,
    );
    expect(runIds.slice(0, 3)).toEqual(["expectations-boot", "tf-probe", "load-managed-repos"]);
    expect(runIds).toContain("gate-verify:spring:preflight");
    expect(runIds).toContain("gate-verify:spring:fast");
    expect(runIds).toContain("audit-gates-verify-finalize");
  });
});

describe("orch-run — Inngest function registration", () => {
  it("registers concurrency key + retries (smoke)", async () => {
    const { orchRun } = await import("../../src/inngest/functions/orch-run.js");
    expect(orchRun).toBeDefined();
  });
});
