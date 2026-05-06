import { describe, expect, it } from "vitest";
import {
  enforceFilesTouched,
  enforceSnapshotFlagBan,
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

describe("enforceFilesTouched edge patterns", () => {
  it("accepts files under suffix-`**` glob without slash (pathInGlob root** branch)", () => {
    const out = enforceFilesTouched(
      {
        status: "patch",
        rationale: "ok",
        patch: "x",
        files_touched: ["srcmain/extra.txt"],
        refusals: [],
        context_request: [],
      },
      ["srcmain**"],
    );
    expect(out.status).toBe("patch");
  });

  it("treats path equal to glob literal as in-lane", () => {
    const out = enforceFilesTouched(
      {
        status: "patch",
        rationale: "ok",
        patch: "x",
        files_touched: ["src/main/java/auth/**"],
        refusals: [],
        context_request: [],
      },
      ["src/main/java/auth/**"],
    );
    expect(out.status).toBe("patch");
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
});
