/**
 * I2 deliverable per vault `Orchestration PoC/Inngest Integration Plan.md` §I2 + ADR 0002.
 *
 * Hono handler at `/api/inngest`. Functions array intentionally empty at I2 —
 * `orch-run` lands at I3 (vault Inngest Plan §I3 + tasks 38/39). I3 merge is
 * gated on prod-binary 37a outbound re-run (ADR 0002 Appendix A caveats).
 *
 * Run via `pnpm run inngest:serve` (mounts on `:3030`); pair w/
 * `pnpm run inngest:dev` in a second terminal (Inngest dev UI on
 * `http://127.0.0.1:8288`).
 *
 * NOTE: excluded from coverage per `vitest.config.ts` (`src/inngest/**`).
 */

import { serve as inngestServe } from "inngest/hono";
import { Hono } from "hono";
import { serve as nodeServe } from "@hono/node-server";
import { inngest } from "./client.js";

// I3 (task 38) will register `orchRun` here. Empty at I2 = handshake-only —
// dev UI shows app registered, zero functions. Verifies serve route alive
// without exposing any event handler.
const functions: Parameters<typeof inngestServe>[0]["functions"] = [];

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, deps: ["inngest", "mastra"], functions: functions.length }),
);

app.on(
  ["GET", "POST", "PUT"],
  "/api/inngest",
  inngestServe({ client: inngest, functions }),
);

const port = Number(process.env.PORT ?? 3030);
nodeServe({ fetch: app.fetch, port });
console.log(
  `[inngest-serve] listening on :${port}/api/inngest (functions=${functions.length})`,
);
console.log(
  `[inngest-serve] dev=${process.env.INNGEST_DEV === "1"} baseUrl=${process.env.INNGEST_BASE_URL ?? "default"}`,
);
