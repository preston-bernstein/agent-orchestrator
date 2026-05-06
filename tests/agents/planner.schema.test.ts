import { describe, expect, it } from "vitest";
import { PlannerOutput } from "../../src/agents/planner/schema.js";

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
      id: `t${i}`, spec_slug: "s", repo: "spring-api", supervisor: "spring", title: `task ${i}`, paths: [`p${i}`], depends_on: [],
    }));
    expect(() =>
      PlannerOutput.parse({ status: "ready", rationale: "too many", tasks, path_ownership_map: {}, refusals: [] }),
    ).toThrow();
  });

  it("rejects unknown status enum", () => {
    expect(() =>
      PlannerOutput.parse({ status: "shipped", rationale: "x", tasks: [], path_ownership_map: {}, refusals: [] }),
    ).toThrow();
  });
});
