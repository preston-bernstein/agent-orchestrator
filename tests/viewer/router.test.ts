import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { viewerRouter } from "../../src/viewer/router.js";

const tmp = path.join(process.cwd(), "runs", "_test_viewer");

function appForTest(): Hono {
  const app = new Hono();
  app.route("/runs", viewerRouter);
  return app;
}

function seedRun(runId: string, supervisor = "spring"): void {
  const dir = path.join(tmp, runId, supervisor);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(tmp, runId, "audit.jsonl"), '{"step":"x"}\n');
  writeFileSync(path.join(dir, "pending.diff"), "diff --git a/x b/x\n");
  writeFileSync(path.join(dir, "approval.md"), "# Approval\n");
  writeFileSync(
    path.join(dir, "approval-payload.json"),
    JSON.stringify({ run_id: runId, supervisor, diff_hash: "a".repeat(64) }),
  );
}

afterEach(async () => {
  delete process.env.RUNS_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe("viewer router", () => {
  it("renders audit for valid run", async () => {
    const runId = "123e4567-e89b-12d3-a456-426614174000";
    seedRun(runId);
    process.env.RUNS_DIR = tmp;
    const res = await appForTest().request(`/runs/${runId}/audit`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("audit");
    expect(text).toContain("step");
  });

  it("rejects invalid run id", async () => {
    process.env.RUNS_DIR = tmp;
    const res = await appForTest().request("/runs/not-a-uuid/audit");
    expect(res.status).toBe(400);
  });

  it("records reject decision via post route", async () => {
    const runId = "123e4567-e89b-12d3-a456-426614174000";
    seedRun(runId, "spring");
    process.env.RUNS_DIR = tmp;
    const body = new URLSearchParams({ kind: "reject", reason: "not ready" });
    const res = await appForTest().request(`/runs/${runId}/spring/decision`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const decisionPath = path.join(tmp, runId, "spring", "approval-decision.json");
    const raw = readFileSync(decisionPath, "utf8");
    expect(raw).toContain('"approved": false');
  });
});
