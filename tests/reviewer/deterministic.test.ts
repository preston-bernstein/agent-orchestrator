import { describe, expect, it } from "vitest";
import type { ManagedRepoMap } from "../../src/config/managedRepos.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";
import {
  runReviewerDeterministic,
  type ReviewerIntegrationVerdict,
} from "../../src/reviewer/deterministic.js";
import type { GateInvocation } from "../../src/gates/runQuality.js";

const PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "t",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "x",
      repo: "spring-api",
      supervisor: "spring",
      title: "t",
      paths: ["src/main/**"],
      depends_on: [],
    },
  ],
  path_ownership_map: { "spring-T1": ["src/main/**"] },
  refusals: [],
};

const OK_GATE: GateInvocation = {
  cmd: ["mvn"],
  cwd: "/x",
  exit: 0,
  oom: false,
  timed_out: false,
  duration_ms: 1,
  log_tail: "",
  kind: "fast",
  stack: "java-spring",
};

function mockRepos(): ManagedRepoMap {
  return {
    spring: {
      repoId: "spring-api",
      supervisorId: "spring",
      cwd: "/fake/spring-api",
      meta: {
        stack: "java-spring",
        codegen_paths: ["src/generated/**"],
        generated_markers: [],
        restricted_paths: ["pom.xml"],
        owners: [],
      },
      profile: {
        id: "java-spring",
        packageManager: "maven",
        installCmd: [],
        qualityFastCmd: [],
        qualityHeavyCmd: [],
        coverageCmd: [],
        coverageReportPath: "",
        coverageFloor: 0.8,
        mutationCmd: [],
        mutationReportPath: "",
        mutationFloor: 0.65,
        preflightCmd: [],
        codegenGlobs: [],
        generatedMarkers: [],
        testRoot: "",
        sourceRoot: "",
        snapshotForbiddenFlags: ["-DskipTests"],
      },
    },
  } as unknown as ManagedRepoMap;
}

function callReviewer(
  diff: string,
  gateHistory: GateInvocation[] = [OK_GATE],
  plan: PlannerOutputT = PLAN,
  integration?: ReviewerIntegrationVerdict,
) {
  return runReviewerDeterministic({
    plan,
    repos: mockRepos(),
    supervisors: [
      {
        supervisorId: "spring",
        stackId: "java-spring",
        diffText: diff,
        gateHistory,
        taskSummaries: [],
      },
    ],
    ...(integration ? { integration } : {}),
  });
}

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

  it("fails on codegen path intersection", () => {
    const diff = ["+++ b/src/generated/Foo.java\n", "+bad\n"].join("");
    const out = callReviewer(diff);
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "codegen-touched")).toBe(true);
  });

  it("fails on restricted path intersection", () => {
    const diff = ["+++ b/pom.xml\n", "+bad\n"].join("");
    const out = callReviewer(diff);
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "restricted-path")).toBe(true);
  });

  it("fails when snapshotForbiddenFlags substring appears in patch", () => {
    const diff = [
      "+++ b/src/main/java/X.java\n",
      "+RUN_TESTS=false -DskipTests=false\n",
    ].join("");
    const out = callReviewer(diff);
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "silencing-not-fixing")).toBe(true);
  });

  it("fails integration verdict block_merge", () => {
    const diff = ["+++ b/src/main/java/X.java\n", "+x\n"].join("");
    const out = callReviewer(diff, [OK_GATE], PLAN, {
      ran: true,
      recommended_action: "block_merge",
      status: "breaking",
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "integration-verdict")).toBe(true);
  });
});
