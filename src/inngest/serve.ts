/**
 * I2 deliverable per vault `Orchestration PoC/Inngest Integration Plan.md` §I2 + ADR 0002.
 *
 * Hono handler at `/api/inngest`. Functions array intentionally empty at I2 —
 * `orch-run` lands at I3 (vault Inngest Plan §I3 + tasks 38/39). I3 merge is
 * gated on prod-binary 37a outbound re-run (ADR 0002 Appendix A caveats).
 *
 * Run `pnpm run inngest:devstack` (recommended: app `:3030` + Inngest dev UI
 * `:8288` in one terminal; Ctrl+C stops both). Or split: `inngest:serve` then
 * `inngest:dev`.
 *
 * NOTE: excluded from coverage per `vitest.config.ts` (`src/inngest/**`).
 */

import { serve as inngestServe } from "inngest/hono";
import { Hono } from "hono";
import { serve as nodeServe } from "@hono/node-server";
import { loadBootConfig } from "../config/env.js";
import { inngest } from "./client.js";
import { orchRun } from "./functions/orch-run.js";
import { viewerRouter } from "../viewer/router.js";

const bootCfg = loadBootConfig();

// I3 (tasks 38/39): `orch-run` registered. Listens on
// `orch/dry-plan.requested` + `orch/run.requested`; per-supervisor
// `step.waitForEvent('orch/approve.<sup>')` between pre-approval + resume.
const functions: Parameters<typeof inngestServe>[0]["functions"] = [orchRun];

const app = new Hono();

app.get("/health", (c) =>
  c.json({ ok: true, deps: ["inngest", "mastra"], functions: functions.length }),
);

app.on(
  ["GET", "POST", "PUT"],
  "/api/inngest",
  inngestServe({ client: inngest, functions }),
);
app.route("/runs", viewerRouter);

const port = Number(process.env.PORT ?? 3030);
nodeServe({ fetch: app.fetch, port });
console.log(
  `[inngest-serve] listening on :${port}/api/inngest (functions=${functions.length})`,
);
console.log(
  `[inngest-serve] dev=${bootCfg.inngestDev} baseUrl=${process.env.INNGEST_BASE_URL ?? "default"}`,
);
console.log(
  `[inngest-serve] MOCK_TF=${bootCfg.mockTf ? "1 (planner/subagent mocks)" : "unset — orch/run.execute will refuse until MOCK_TF=1 or real TF wiring"}`,
);
if (!bootCfg.mockTf) {
  console.warn(
    "[inngest-serve] orch-run execute branch needs MOCK_TF=1 on this process (or extend runExecuteLane for real TF).",
  );
}
const reposHint = bootCfg.ORCH_MANAGED_REPOS?.trim();
if (!reposHint) {
  console.warn(
    "[inngest-serve] ORCH_MANAGED_REPOS unset — orch/run.execute will fail if the plan references managed supervisors.",
  );
}
