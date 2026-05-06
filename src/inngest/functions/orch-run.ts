/**
 * Orchestrator durability entry (Inngest). Core handler lives under
 * `src/inngest/orchestratorRun/handler.ts` (boot → planner-branch → execute).
 * Repo tests call `orchRunHandler` directly; `src/inngest/**` is excluded from
 * coverage in `vitest.config.ts`.
 */

import { inngest } from "../client.js";
import { orchRunHandler } from "../orchestratorRun/handler.js";
import type {
  OrchStep,
  OrchRunResult,
  OrchRunEvent,
} from "../orchestratorRun/types.js";

export type { OrchStep, OrchRunResult };
export type OrchRunHandlerInput = Parameters<typeof orchRunHandler>[0];

export { orchRunHandler };

export const orchRun = inngest.createFunction(
  {
    id: "orch-run",
    concurrency: [{ key: "event.data.runId", limit: 1 }],
    retries: 2,
  },
  [
    { event: "orch/dry-plan.requested" },
    { event: "orch/run.requested" },
    { event: "orch/gates.verify.requested" },
  ],
  ({ event, step }) =>
    orchRunHandler({
      event: event as OrchRunEvent,
      step: step as unknown as OrchStep,
    }),
);
