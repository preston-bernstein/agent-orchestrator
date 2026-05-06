import type { OrchStep, OrchRunEvent, OrchRunOverrides, OrchRunResult } from "./types.js";
import { runOrchBootstrapSteps, runOrchPrePlannerSteps } from "./bootstrap.js";
import { runOrchGatesVerifyHandler } from "./gatesVerifyHandler.js";
import { orchRouteAfterPlanner } from "./runExecutePath.js";

export async function orchRunHandler(input: {
  event: OrchRunEvent;
  step: OrchStep;
  overrides?: OrchRunOverrides;
  repoRoot?: string;
}): Promise<OrchRunResult> {
  if (input.event.name === "orch/gates.verify.requested") {
    const ctx = await runOrchPrePlannerSteps(input);
    return runOrchGatesVerifyHandler({
      step: input.step,
      ctx,
      data: input.event.data,
      overrides: input.overrides,
    });
  }
  const bundle = await runOrchBootstrapSteps(input);
  type OrchPlanEvent = Exclude<OrchRunEvent, { name: "orch/gates.verify.requested" }>;
  return orchRouteAfterPlanner(
    input.step,
    input.event as OrchPlanEvent,
    bundle.ctx,
    bundle.outcome,
    input.overrides,
  );
}
