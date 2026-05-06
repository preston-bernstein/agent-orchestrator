import { describe, expect, it } from "vitest";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import type { GateInvocation } from "../../src/gates/runQuality.js";
import { callReviewer, OK_GATE, PLAN } from "./deterministic.helpers.js";

describe("reviewer/runReviewerDeterministic", () => {
  it("passes when gates green + paths in ownership", () => {
    const diff = [
      "diff --git a/src/main/java/X.java b/src/main/java/X.java\n",
      "+++ b/src/main/java/X.java\n",
      "+ok\n",
    ].join("");
    const out = callReviewer(diff);
    expect(out.status).toBe("pass");
    expect(out.findings).toHaveLength(0);
  });

  it("gate_summary is skipped/skipped when no gate invocations were recorded", () => {
    const diff = ["+++ b/src/main/java/X.java\n", "+ok\n"].join("");
    const out = callReviewer(diff, []);
    expect(out.gate_summary).toEqual({ fast: "skipped", heavy: "skipped" });
    expect(out.status).toBe("pass");
  });

  it("fails when diff touches path outside plan.path_ownership_map union", () => {
    const diff = ["+++ b/src/billing/Foo.java\n", "+no\n"].join("");
    const out = callReviewer(diff);
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "out-of-scope-edit")).toBe(true);
  });

  it("unionOwnership includes globs from every task for that supervisor", () => {
    const plan2: PlannerOutputT = {
      ...PLAN,
      tasks: [
        {
          id: "spring-T1",
          spec_slug: "x",
          repo: "spring-api",
          supervisor: "spring",
          title: "t1",
          paths: ["src/main/**"],
          depends_on: [],
        },
        {
          id: "spring-T2",
          spec_slug: "x",
          repo: "spring-api",
          supervisor: "spring",
          title: "t2",
          paths: ["src/other/**"],
          depends_on: [],
        },
      ],
      path_ownership_map: {
        "spring-T1": ["src/main/**"],
        "spring-T2": ["src/other/**"],
      },
    };
    const diff = ["+++ b/src/other/Z.java\n", "+z\n"].join("");
    const out = callReviewer(diff, [OK_GATE], plan2);
    expect(out.status).toBe("pass");
  });

  it("fails on gate exit non-zero", () => {
    const diff = ["+++ b/src/main/java/X.java\n", "+x\n"].join("");
    const bad: GateInvocation = { ...OK_GATE, exit: 1 };
    const out = callReviewer(diff, [bad]);
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "gate-failed")).toBe(true);
  });
});

