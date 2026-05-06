import { describe, expect, it } from "vitest";
import {
  SubagentSchemaError,
  mockSubagentCompletion,
  runSubagent,
} from "../../src/agents/subagent/index.js";
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

describe("runSubagent — happy + refusals", () => {
  it("returns parsed patch from injected completion", async () => {
    const out = await runSubagent(
      {
        task: TASK,
        stackProfile: javaSpringProfile,
        path_ownership_map: PATH_OWNERSHIP,
      },
      {
        completion: mockSubagentCompletion(
          "diff --git a/src/main/java/auth/A.java b/src/main/java/auth/A.java\n",
          ["src/main/java/auth/A.java"],
        ),
      },
    );
    expect(out.status).toBe("patch");
    expect(out.files_touched).toEqual(["src/main/java/auth/A.java"]);
  });

  it("flips to refused if mock returns out-of-lane file (post-LLM defense)", async () => {
    const out = await runSubagent(
      {
        task: TASK,
        stackProfile: javaSpringProfile,
        path_ownership_map: PATH_OWNERSHIP,
      },
      {
        completion: mockSubagentCompletion(
          "diff --git a/src/other/X.java b/src/other/X.java\n",
          ["src/other/X.java"],
        ),
      },
    );
    expect(out.status).toBe("refused");
  });

  it("throws SubagentSchemaError on malformed completion output", async () => {
    await expect(
      runSubagent(
        {
          task: TASK,
          stackProfile: javaSpringProfile,
          path_ownership_map: PATH_OWNERSHIP,
        },
        { completion: async () => ({ status: "garbage" }) },
      ),
    ).rejects.toBeInstanceOf(SubagentSchemaError);
  });

  it("rejects via assemblePrompt when task.paths violate path_ownership_map", async () => {
    const wrongMap = { "spring-T1": ["other/**"] };
    await expect(
      runSubagent(
        {
          task: TASK,
          stackProfile: javaSpringProfile,
          path_ownership_map: wrongMap,
        },
        { completion: mockSubagentCompletion() },
      ),
    ).rejects.toThrow(/path_ownership_map violation/);
  });
});
