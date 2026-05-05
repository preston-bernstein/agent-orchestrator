/**
 * I2 deliverable per vault `Orchestration PoC/Inngest Integration Plan.md` §I2 + ADR 0002.
 *
 * Self-host only. `INNGEST_BASE_URL` must point at local dev server (laptop)
 * or internal LAN host (prod-later). **Inngest Cloud rejected** per hard
 * internal-only constraint (ADR 0002 §Decision).
 *
 * Distinct event types (vs single event w/ `mode` field) chosen for clearer
 * routing, simpler concurrency keys, simpler dashboards. See ADR 0002
 * §Alternatives considered for trade-offs.
 *
 * NOTE: this file is excluded from coverage per `vitest.config.ts`
 * (`src/inngest/**`) — runtime entrypoint, exercised by I3+ E2E only.
 */

import { Inngest, EventSchemas } from "inngest";
import { z } from "zod";

const repoIdSchema = z.enum(["spring-api", "react-ui", "agent-orchestrator"]);

const events = {
  "orch/dry-plan.requested": {
    data: z.object({
      runId: z.string().uuid(),
      specSlug: z.string(),
      repo: repoIdSchema,
    }),
  },
  "orch/run.requested": {
    data: z.object({
      runId: z.string().uuid(),
      specSlug: z.string(),
      repo: repoIdSchema,
      reason: z.string().optional(),
    }),
  },
  "orch/approve.spring": {
    data: z.object({
      runId: z.string().uuid(),
      diffHash: z.string(),
      approver: z.string(),
      reason: z.string().optional(),
    }),
  },
  "orch/approve.react": {
    data: z.object({
      runId: z.string().uuid(),
      diffHash: z.string(),
      approver: z.string(),
      reason: z.string().optional(),
    }),
  },
  "orch/cancel.requested": {
    data: z.object({
      runId: z.string().uuid(),
      reason: z.string(),
    }),
  },
} as const;

export const inngest = new Inngest({
  id: "agent-orchestrator",
  schemas: new EventSchemas().fromZod(events),
  isDev: process.env.INNGEST_DEV === "1",
});

export type OrchEvents = typeof events;

export const orchEventNames = Object.keys(events) as Array<keyof typeof events>;

export const eventSchemas = events;
