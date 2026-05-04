import { describe, expect, it } from "vitest";
import {
  PlannerSchemaError,
  mockPlannerCompletion,
  runPlanner,
} from "../../src/agents/planner.js";
import { PlannerOutput } from "../../src/agents/planner.schema.js";
import type { SpecSnapshotT } from "../../src/runs/RunContext.js";

const SPEC_NO_OP: SpecSnapshotT = {
  slug: "no-op",
  repo: "agent-orchestrator",
  stack: "ts-node",
  requirements_path: "specs/no-op.md",
  tasks_path: "specs/no-op.md",
  design_path: "specs/no-op.md",
  hash: "0".repeat(64),
};

const SPEC_SPRING: SpecSnapshotT = {
  slug: "auth-feature",
  repo: "spring-api",
  stack: "java-spring",
  requirements_path: "docs/specs/auth/requirements.md",
  tasks_path: "docs/specs/auth/tasks.md",
  design_path: "docs/specs/auth/design.md",
  hash: "1".repeat(64),
};

describe("PlannerOutput schema (O1)", () => {
  it("parses a minimal ready plan", () => {
    const ok = PlannerOutput.parse({
      status: "ready",
      rationale: "ok",
      tasks: [],
      path_ownership_map: {},
      refusals: [],
    });
    expect(ok.status).toBe("ready");
  });

  it("rejects rationale > 200 chars (no chain-of-thought)", () => {
    expect(() =>
      PlannerOutput.parse({
        status: "ready",
        rationale: "x".repeat(201),
        tasks: [],
        path_ownership_map: {},
        refusals: [],
      }),
    ).toThrow();
  });

  it("rejects > 20 tasks (planner must split)", () => {
    const tasks = Array.from({ length: 21 }, (_v, i) => ({
      id: `t${i}`,
      spec_slug: "s",
      repo: "spring-api",
      supervisor: "spring",
      title: `task ${i}`,
      paths: [`p${i}`],
      depends_on: [],
    }));
    expect(() =>
      PlannerOutput.parse({
        status: "ready",
        rationale: "too many",
        tasks,
        path_ownership_map: {},
        refusals: [],
      }),
    ).toThrow();
  });

  it("rejects unknown status enum", () => {
    expect(() =>
      PlannerOutput.parse({
        status: "shipped",
        rationale: "x",
        tasks: [],
        path_ownership_map: {},
        refusals: [],
      }),
    ).toThrow();
  });
});

describe("runPlanner — capability + spec gates", () => {
  it("refuses when tf_capabilities.structured_output=false (edge 45)", async () => {
    const out = await runPlanner(
      {
        specs: [SPEC_SPRING],
        cli_flags: {},
        tf_capabilities: { structured_output: false, tool_use: true },
      },
      { completion: async () => ({ status: "ready", rationale: "x", tasks: [], path_ownership_map: {}, refusals: [] }) },
    );
    expect(out.status).toBe("refused");
    expect(out.refusals).toContain("TF lacks structured output");
  });

  it("refuses when no specs provided", async () => {
    const out = await runPlanner(
      { specs: [], cli_flags: {} },
      { completion: async () => ({}) },
    );
    expect(out.status).toBe("refused");
  });

  it("calls completion when capabilities ok + returns parsed plan", async () => {
    const calls: number[] = [];
    const out = await runPlanner(
      { specs: [SPEC_SPRING], cli_flags: {} },
      {
        completion: async () => {
          calls.push(1);
          return {
            status: "ready",
            rationale: "single task",
            tasks: [
              {
                id: "spring-T1",
                spec_slug: "auth-feature",
                repo: "spring-api",
                supervisor: "spring",
                title: "add auth endpoint",
                paths: ["src/main/java/auth/**"],
                depends_on: [],
              },
            ],
            path_ownership_map: { "spring-T1": ["src/main/java/auth/**"] },
            refusals: [],
          };
        },
      },
    );
    expect(calls.length).toBe(1);
    expect(out.status).toBe("ready");
    expect(out.tasks[0]?.id).toBe("spring-T1");
  });

  it("throws PlannerSchemaError on malformed completion output", async () => {
    await expect(
      runPlanner(
        { specs: [SPEC_SPRING], cli_flags: {} },
        { completion: async () => ({ status: "garbage" }) },
      ),
    ).rejects.toBeInstanceOf(PlannerSchemaError);
  });
});

describe("mockPlannerCompletion (O4 fixture lane)", () => {
  it("returns ready plan w/ one task per spec; supervisor mapping correct", async () => {
    const completion = mockPlannerCompletion([SPEC_NO_OP, SPEC_SPRING]);
    const out = await completion({} as never);
    expect(out.status).toBe("ready");
    expect(out.tasks.length).toBe(2);
    expect(out.tasks[0]?.supervisor).toBe("orch");
    expect(out.tasks[1]?.supervisor).toBe("spring");
    expect(out.path_ownership_map["mock-T2"]).toEqual([
      "mock/auth-feature/**",
    ]);
  });

  it("returns refused on empty specs[]", async () => {
    const completion = mockPlannerCompletion([]);
    const out = await completion({} as never);
    expect(out.status).toBe("refused");
  });
});
