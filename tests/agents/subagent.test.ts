import { describe, expect, it } from "vitest";
import {
  SubagentSchemaError,
  enforceFilesTouched,
  enforceSnapshotFlagBan,
  mockSubagentCompletion,
  runSubagent,
} from "../../src/agents/subagent.js";
import { SubagentOutput } from "../../src/agents/subagent.schema.js";
import type { PlannerTaskT } from "../../src/agents/planner.schema.js";
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

describe("SubagentOutput schema (O1)", () => {
  it("parses minimal patch output", () => {
    const ok = SubagentOutput.parse({
      status: "patch",
      rationale: "ok",
      patch: "diff --git a/x b/x\n",
      files_touched: ["x"],
      refusals: [],
      context_request: [],
    });
    expect(ok.status).toBe("patch");
  });

  it("rejects rationale > 200 chars", () => {
    expect(() =>
      SubagentOutput.parse({
        status: "patch",
        rationale: "x".repeat(201),
        patch: "",
        files_touched: [],
      }),
    ).toThrow();
  });

  it("rejects unknown status enum", () => {
    expect(() =>
      SubagentOutput.parse({
        status: "shipped",
        rationale: "x",
        patch: "",
        files_touched: [],
      }),
    ).toThrow();
  });
});

describe("enforceFilesTouched (defensive scope check)", () => {
  it("passes when files_touched all under task.paths globs", () => {
    const out = enforceFilesTouched(
      {
        status: "patch",
        rationale: "ok",
        patch: "diff --git a/src/main/java/auth/A.java b/src/main/java/auth/A.java\n",
        files_touched: ["src/main/java/auth/A.java"],
        refusals: [],
        context_request: [],
      },
      TASK.paths,
    );
    expect(out.status).toBe("patch");
  });

  it("flips to refused if any file outside task.paths", () => {
    const out = enforceFilesTouched(
      {
        status: "patch",
        rationale: "ok",
        patch: "diff --git a/src/main/resources/db/migration/V1.sql b/...\n",
        files_touched: ["src/main/resources/db/migration/V1.sql"],
        refusals: [],
        context_request: [],
      },
      TASK.paths,
    );
    expect(out.status).toBe("refused");
    expect(out.rationale).toMatch(/^out of scope: /);
    expect(out.patch).toBe("");
  });

  it("ignores non-patch statuses (no_change / refused / needs_more_context)", () => {
    const out = enforceFilesTouched(
      {
        status: "no_change",
        rationale: "ok",
        patch: "",
        files_touched: [],
        refusals: [],
        context_request: [],
      },
      TASK.paths,
    );
    expect(out.status).toBe("no_change");
  });
});

describe("enforceSnapshotFlagBan (StackProfile.snapshotForbiddenFlags)", () => {
  it("flips to refused if patch embeds -DskipTests (java-spring overlay)", () => {
    const out = enforceSnapshotFlagBan(
      {
        status: "patch",
        rationale: "ok",
        patch: "diff --git a/pom.xml b/pom.xml\n+    <skip>-DskipTests</skip>\n",
        files_touched: ["pom.xml"],
        refusals: [],
        context_request: [],
      },
      javaSpringProfile,
    );
    expect(out.status).toBe("refused");
    expect(out.rationale).toMatch(/snapshot auto-pass forbidden/);
  });

  it("passes when patch is clean", () => {
    const out = enforceSnapshotFlagBan(
      {
        status: "patch",
        rationale: "ok",
        patch: "diff --git a/X.java b/X.java\n",
        files_touched: ["X.java"],
        refusals: [],
        context_request: [],
      },
      javaSpringProfile,
    );
    expect(out.status).toBe("patch");
  });
});

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
