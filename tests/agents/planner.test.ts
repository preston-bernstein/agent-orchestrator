import { describe, expect, it } from "vitest";
import {
  PlannerSchemaError,
  runPlanner,
} from "../../src/agents/planner/index.js";
import type { SpecSnapshotT } from "../../src/runs/RunContext.js";

const SPEC_SPRING: SpecSnapshotT = {
  slug: "auth-feature",
  repo: "spring-api",
  stack: "java-spring",
  requirements_path: "docs/specs/auth/requirements.md",
  tasks_path: "docs/specs/auth/tasks.md",
  design_path: "docs/specs/auth/design.md",
  hash: "1".repeat(64),
};


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

