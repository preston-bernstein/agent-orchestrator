import { describe, expect, it } from "vitest";
import type { ManagedRepoMap } from "../../src/config/managedRepos.js";
import type { PlannerOutputT } from "../../src/agents/planner/schema.js";
import {
  runReviewerDeterministic,
  type ReviewerIntegrationVerdict,
} from "../../src/reviewer/deterministic.js";
import type { GateInvocation } from "../../src/gates/runQuality.js";

const PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "t",
  tasks: [{ id: "spring-T1", spec_slug: "x", repo: "spring-api", supervisor: "spring", title: "t", paths: ["src/main/**"], depends_on: [] }],
  path_ownership_map: { "spring-T1": ["src/main/**"] },
  refusals: [],
};

const OK_GATE: GateInvocation = {
  cmd: ["mvn"], cwd: "/x", exit: 0, oom: false, timed_out: false, duration_ms: 1, log_tail: "", kind: "fast", stack: "java-spring",
};

function mockRepos(): ManagedRepoMap {
  return {
    spring: {
      repoId: "spring-api",
      supervisorId: "spring",
      cwd: "/fake/spring-api",
      meta: { stack: "java-spring", codegen_paths: ["src/generated/**"], generated_markers: [], restricted_paths: ["pom.xml"], owners: [] },
      profile: { id: "java-spring", packageManager: "maven", installCmd: [], qualityFastCmd: [], qualityHeavyCmd: [], coverageCmd: [], coverageReportPath: "", coverageFloor: 0.8, mutationCmd: [], mutationReportPath: "", mutationFloor: 0.65, preflightCmd: [], codegenGlobs: [], generatedMarkers: [], testRoot: "", sourceRoot: "", snapshotForbiddenFlags: ["-DskipTests"] },
    },
  } as unknown as ManagedRepoMap;
}

function callReviewer(diff: string, gateHistory: GateInvocation[] = [OK_GATE], plan: PlannerOutputT = PLAN, integration?: ReviewerIntegrationVerdict) {
  return runReviewerDeterministic({
    plan,
    repos: mockRepos(),
    supervisors: [{ supervisorId: "spring", stackId: "java-spring", diffText: diff, gateHistory, taskSummaries: [] }],
    ...(integration ? { integration } : {}),
  });
}

describe("reviewer/runReviewerDeterministic policy refusals", () => {
  it("fails on codegen path intersection", () => {
    const out = callReviewer(["+++ b/src/generated/Foo.java\n", "+bad\n"].join(""));
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "codegen-touched")).toBe(true);
  });

  it("fails on restricted path intersection", () => {
    const out = callReviewer(["+++ b/pom.xml\n", "+bad\n"].join(""));
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "restricted-path")).toBe(true);
  });

  it("fails when snapshotForbiddenFlags substring appears in patch", () => {
    const out = callReviewer(["+++ b/src/main/java/X.java\n", "+RUN_TESTS=false -DskipTests=false\n"].join(""));
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "silencing-not-fixing")).toBe(true);
  });

  it("fails integration verdict block_merge", () => {
    const out = callReviewer(["+++ b/src/main/java/X.java\n", "+x\n"].join(""), [OK_GATE], PLAN, { ran: true, recommended_action: "block_merge", status: "breaking" });
    expect(out.status).toBe("fail");
    expect(out.findings.some((f) => f.rule === "integration-verdict")).toBe(true);
  });
});
