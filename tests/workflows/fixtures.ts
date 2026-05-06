import type { ExpectationsSnapshot } from "../../src/config/expectations.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";

export const SNAPSHOT: ExpectationsSnapshot = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

export const SCENARIO_A_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "scenario A — single spring task, API-only",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "auth-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "add auth endpoint",
      paths: ["src/main/java/auth/**", "src/test/java/auth/**"],
      depends_on: [],
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/main/java/auth/**", "src/test/java/auth/**"],
  },
  refusals: [],
};

export const OVERLAP_PLAN: PlannerOutputT = {
  ...SCENARIO_A_PLAN,
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "auth-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "t1",
      paths: ["src/main/java/auth/**"],
      depends_on: [],
    },
    {
      id: "spring-T2",
      spec_slug: "auth-feature",
      repo: "spring-api",
      supervisor: "spring",
      title: "t2",
      paths: ["src/main/java/auth/**"],
      depends_on: [],
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/main/java/auth/**"],
    "spring-T2": ["src/main/java/auth/**"],
  },
};
