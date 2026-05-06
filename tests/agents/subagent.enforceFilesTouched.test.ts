import { describe, expect, it } from "vitest";
import { enforceFilesTouched } from "../../src/agents/subagent/index.js";
import type { PlannerTaskT } from "../../src/agents/planner/schema.js";

const TASK: PlannerTaskT = {
  id: "spring-T1",
  spec_slug: "auth-feature",
  repo: "spring-api",
  supervisor: "spring",
  title: "add auth endpoint",
  paths: ["src/main/java/auth/**", "src/test/java/auth/**"],
  depends_on: [],
};

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

  it("accepts files under `/**` ownership glob", () => {
    const out = enforceFilesTouched(
      {
        status: "patch",
        rationale: "ok",
        patch: "x",
        files_touched: ["src/main/java/auth/Foo.java"],
        refusals: [],
        context_request: [],
      },
      ["src/main/java/auth/**"],
    );
    expect(out.status).toBe("patch");
  });
});
