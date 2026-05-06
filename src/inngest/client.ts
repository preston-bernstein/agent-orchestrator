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

const gateKindsSchema = z.array(z.enum(["preflight", "fast", "heavy"]));

const events = {
  "orch/dry-plan.requested": {
    data: z.object({
      runId: z.string().uuid(),
      specSlug: z.string(),
      repo: repoIdSchema,
      specPath: z.string().min(1),
      dangerApply: z.boolean().optional(),
    }),
  },
  "orch/gates.verify.requested": {
    data: z.object({
      runId: z.string().uuid(),
      specSlug: z.string(),
      repo: repoIdSchema,
      specPath: z.string().min(1),
      gateKinds: gateKindsSchema.optional(),
    }),
  },
  "orch/run.requested": {
    data: z.object({
      runId: z.string().uuid(),
      specSlug: z.string(),
      repo: repoIdSchema,
      specPath: z.string().min(1),
      reason: z.string().optional(),
      dangerApply: z.boolean().optional(),
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

/**
 * Only pass `isDev` when `INNGEST_DEV` is explicitly set. If we pass
 * `isDev: false` when the var is absent, the SDK locks to **cloud** mode and
 * refuses `send()` without `INNGEST_EVENT_KEY`. Omitting `isDev` lets the SDK
 * infer dev on a typical laptop (`pnpm run orchestrate -- --spec …` w/
 * `inngest dev` — no cloud key).
 */
function inngestDevConstructorOption(): { isDev: boolean } | Record<string, never> {
  const raw = process.env.INNGEST_DEV;
  if (raw === undefined) return {};
  const t = raw.toLowerCase();
  if (raw === "1" || t === "true") return { isDev: true };
  if (raw === "0" || t === "false") return { isDev: false };
  return {};
}

export const inngest = new Inngest({
  id: "agent-orchestrator",
  schemas: new EventSchemas().fromZod(events),
  ...inngestDevConstructorOption(),
});

export const orchEventNames = Object.keys(events) as Array<keyof typeof events>;

export const eventSchemas = events;
