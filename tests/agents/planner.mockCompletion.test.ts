import { describe, expect, it } from "vitest";
import { mockPlannerCompletion } from "../../src/agents/planner/index.js";
import type { SpecSnapshotT } from "../../src/runs/RunContext.js";

const SPEC_NO_OP: SpecSnapshotT = {
  slug: "no-op",
  repo: "agent-orchestrator",
  stack: "ts-node",
  requirements_path: "fixtures/no-op.md",
  tasks_path: "fixtures/no-op.md",
  design_path: "fixtures/no-op.md",
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

describe("mockPlannerCompletion (O4 fixture lane)", () => {
  it("returns ready plan w/ one task per spec; supervisor mapping correct", async () => {
    const completion = mockPlannerCompletion([SPEC_NO_OP, SPEC_SPRING]);
    const out = await completion({} as never);
    expect(out.status).toBe("ready");
    expect(out.tasks.length).toBe(2);
    expect(out.tasks[0]?.supervisor).toBe("orch");
    expect(out.tasks[1]?.supervisor).toBe("spring");
    expect(out.path_ownership_map["mock-T2"]).toEqual(["mock/auth-feature/**"]);
  });

  it("returns refused on empty specs[]", async () => {
    const completion = mockPlannerCompletion([]);
    const out = await completion({} as never);
    expect(out.status).toBe("refused");
  });
});
