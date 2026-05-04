import { describe, expect, it } from "vitest";
import type { ManagedRepoMap } from "../../src/config/managedRepos.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";
import { runReviewerDeterministic } from "../../src/reviewer/deterministic.js";
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

describe("reviewer/runReviewerDeterministic", () => {
  it("passes when gates green + paths in ownership", () => {
    const diff = [
      "diff --git a/src/main/java/X.java b/src/main/java/X.java\n",
      "+++ b/src/main/java/X.java\n",
      "+ok\n",
    ].join("");
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [OK_GATE],
          taskSummaries: [],
        },
      ],
    });
    expect(out.status).toBe("pass");
    expect(out.findings).toHaveLength(0);
  });

  it("fails on gate exit non-zero", () => {
    const diff = [
      "+++ b/src/main/java/X.java\n",
      "+x\n",
    ].join("");
    const bad: GateInvocation = { ...OK_GATE, exit: 1 };
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [bad],
          taskSummaries: [],
        },
      ],
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "gate-failed")).toBe(true);
  });

  it("fails on codegen path intersection", () => {
    const diff = [
      "+++ b/src/generated/Foo.java\n",
      "+bad\n",
    ].join("");
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [OK_GATE],
          taskSummaries: [],
        },
      ],
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "codegen-touched")).toBe(true);
  });

  it("fails on restricted path intersection", () => {
    const diff = [
      "+++ b/pom.xml\n",
      "+bad\n",
    ].join("");
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [OK_GATE],
          taskSummaries: [],
        },
      ],
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "restricted-path")).toBe(true);
  });

  it("fails when snapshotForbiddenFlags substring appears in patch", () => {
    const diff = [
      "+++ b/src/main/java/X.java\n",
      "+RUN_TESTS=false -DskipTests=false\n",
    ].join("");
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [OK_GATE],
          taskSummaries: [],
        },
      ],
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "silencing-not-fixing")).toBe(true);
  });

  it("fails integration verdict block_merge", () => {
    const diff = ["+++ b/src/main/java/X.java\n", "+x\n"].join("");
    const out = runReviewerDeterministic({
      plan: PLAN,
      repos: mockRepos(),
      supervisors: [
        {
          supervisorId: "spring",
          stackId: "java-spring",
          diffText: diff,
          gateHistory: [OK_GATE],
          taskSummaries: [],
        },
      ],
      integration: {
        ran: true,
        recommended_action: "block_merge",
        status: "breaking",
      },
    });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "integration-verdict")).toBe(true);
  });
});
