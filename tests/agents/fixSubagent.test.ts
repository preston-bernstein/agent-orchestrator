import { describe, expect, it } from "vitest";
import {
  mockFixSubagentCompletion,
  runFixSubagent,
} from "../../src/agents/fixSubagent.js";
import type { PlannerTaskT } from "../../src/agents/planner/schema.js";
import { javaSpringProfile } from "../../src/stacks/javaSpring.js";

const TASK: PlannerTaskT = {
  id: "spring-T1",
  spec_slug: "auth-feature",
  repo: "spring-api",
  supervisor: "spring",
  title: "add auth endpoint",
  paths: ["src/main/java/auth/**", "src/test/java/auth/**"],
  depends_on: [],
};

const PATH_OWNERSHIP = {
  "spring-T1": ["src/main/java/auth/**", "src/test/java/auth/**"],
};

describe("runFixSubagent — cycle-aware refusal (vault edge 10)", () => {
  it("refuses with 'fix budget exceeded' when attempt > max_fix_loops", async () => {
    const completion = mockFixSubagentCompletion();
    const out = await runFixSubagent(
      {
        task: TASK,
        stackProfile: javaSpringProfile,
        prior_patch: "",
        gate_log_excerpt: "x",
        failing_gate: "mvn-verify",
        attempt: 4,
        max_fix_loops: 3,
        path_ownership_map: PATH_OWNERSHIP,
      },
      { completion },
    );
    expect(out.status).toBe("refused");
    expect(out.refusals).toContain("fix budget exceeded");
  });

  it("calls completion when attempt within budget", async () => {
    let called = 0;
    const out = await runFixSubagent(
      {
        task: TASK,
        stackProfile: javaSpringProfile,
        prior_patch: "diff --git a/x b/x\n",
        gate_log_excerpt: "FAIL: NullPointerException at A.java:42",
        failing_gate: "mvn-verify",
        attempt: 1,
        max_fix_loops: 3,
        path_ownership_map: PATH_OWNERSHIP,
      },
      {
        completion: async () => {
          called++;
          return mockFixSubagentCompletion(
            "diff --git a/src/main/java/auth/A.java b/...\n",
            ["src/main/java/auth/A.java"],
          )({} as never);
        },
      },
    );
    expect(called).toBe(1);
    expect(out.status).toBe("patch");
  });
});

describe("runFixSubagent — safety checks", () => {
  it("post-LLM ban-list still applies (-DskipTests embedded in in-lane fix patch)", async () => {
    const out = await runFixSubagent(
      {
        task: TASK,
        stackProfile: javaSpringProfile,
        prior_patch: "",
        gate_log_excerpt: "fail",
        failing_gate: "mvn-verify",
        attempt: 1,
        max_fix_loops: 3,
        path_ownership_map: PATH_OWNERSHIP,
      },
      {
        completion: async () => ({
          status: "patch",
          rationale: "silencing fix",
          patch:
            "diff --git a/src/test/java/auth/A.java b/src/test/java/auth/A.java\n" +
            "+// surefire arg: -DskipTests\n",
          files_touched: ["src/test/java/auth/A.java"],
          refusals: [],
          context_request: [],
        }),
      },
    );
    expect(out.status).toBe("refused");
    expect(out.rationale).toMatch(/snapshot auto-pass forbidden/);
  });
});
