import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { writeApprovalDecision, sendApprovalEvent } from "../approval/wait.js";

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUP_RE = /^[a-z][a-z0-9-]{0,30}$/;

function badInput(): Response {
  return new Response("bad request", { status: 400 });
}

function readOr404(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

function validateParams(runId: string, supervisor?: string): boolean {
  if (!RUN_ID_RE.test(runId)) return false;
  if (supervisor !== undefined && !SUP_RE.test(supervisor)) return false;
  return true;
}

function runsRoot(): string {
  return path.resolve(process.env.RUNS_DIR ?? "runs");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
}

export const viewerRouter = new Hono();

viewerRouter.get("/:runId/audit", (c) => {
  const runId = c.req.param("runId");
  if (!validateParams(runId)) return badInput();
  const p = path.join(runsRoot(), runId, "audit.jsonl");
  const raw = readOr404(p);
  if (raw === null) return new Response("not found", { status: 404 });
  return c.html(htmlPage(`audit ${runId}`, `<pre>${raw.replaceAll("<", "&lt;")}</pre>`));
});

viewerRouter.get("/:runId/:supervisor/pending.diff", (c) => {
  const runId = c.req.param("runId");
  const supervisor = c.req.param("supervisor");
  if (!validateParams(runId, supervisor)) return badInput();
  const p = path.join(runsRoot(), runId, supervisor, "pending.diff");
  const raw = readOr404(p);
  if (raw === null) return new Response("not found", { status: 404 });
  return c.text(raw, 200, { "content-type": "text/plain; charset=utf-8" });
});

viewerRouter.get("/:runId/:supervisor/approval.md", (c) => {
  const runId = c.req.param("runId");
  const supervisor = c.req.param("supervisor");
  if (!validateParams(runId, supervisor)) return badInput();
  const p = path.join(runsRoot(), runId, supervisor, "approval.md");
  const raw = readOr404(p);
  if (raw === null) return new Response("not found", { status: 404 });
  const escaped = raw.replaceAll("<", "&lt;");
  const form = `<form method="post" action="/runs/${runId}/${supervisor}/decision"><label>approver <input name="approver" /></label><label>kind <select name="kind"><option value="approve">approve</option><option value="reject">reject</option></select></label><label>reason <input name="reason" /></label><button type="submit">submit</button></form>`;
  return c.html(htmlPage(`approval ${runId}/${supervisor}`, `${form}<pre>${escaped}</pre>`));
});

viewerRouter.post("/:runId/:supervisor/decision", async (c) => {
  const runId = c.req.param("runId");
  const supervisor = c.req.param("supervisor");
  if (!validateParams(runId, supervisor)) return badInput();
  const body = await c.req.parseBody();
  const kind = String(body.kind ?? "");
  const reason = String(body.reason ?? "");
  const approved = kind === "approve";
  if (!approved && reason.trim().length === 0) {
    return new Response("reject requires reason", { status: 400 });
  }
  const decision = writeApprovalDecision({
    runId,
    supervisor,
    approved,
    ...(reason ? { reason } : {}),
    ...(process.env.RUNS_DIR ? { runsDir: process.env.RUNS_DIR } : {}),
  });
  await sendApprovalEvent(decision);
  return c.json({ ok: true, decision });
});
