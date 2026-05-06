import type { SpecSnapshotT } from "../../runs/RunContext.js";
import type { AssembledPrompt } from "../../llm/assemblePrompt.js";
import type { PlannerOutputT } from "./schema.js";

export function mockPlannerCompletion(
  specs: readonly SpecSnapshotT[],
): (prompt: AssembledPrompt) => Promise<PlannerOutputT> {
  return async () => {
    if (specs.length === 0) {
      return {
        status: "refused",
        rationale: "mock: no specs",
        tasks: [],
        path_ownership_map: {},
        refusals: ["no spec"],
      };
    }
    const tasks = specs.map((s, i) => {
      let supervisor: "spring" | "react" | "orch" = "orch";
      if (s.repo === "spring-api") supervisor = "spring";
      else if (s.repo === "react-ui") supervisor = "react";
      return {
        id: `mock-T${i + 1}`,
        spec_slug: s.slug,
        repo: (s.repo === "spring-api" || s.repo === "react-ui"
          ? s.repo
          : "agent-orchestrator") as "spring-api" | "react-ui" | "agent-orchestrator",
        supervisor,
        title: `mock task for ${s.slug}`,
        paths: [`mock/${s.slug}/**`],
        depends_on: [] as string[],
      };
    });
    const path_ownership_map: Record<string, string[]> = {};
    for (const t of tasks) path_ownership_map[t.id] = t.paths;
    return {
      status: "ready",
      rationale: "mock TF — fixture plan for offline tests",
      tasks,
      path_ownership_map,
      refusals: [],
    };
  };
}
