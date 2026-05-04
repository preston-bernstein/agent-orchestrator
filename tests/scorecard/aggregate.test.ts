import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditWriter } from "../../src/audit/jsonl.js";
import {
  accumulateTotals,
  buildScorecardModel,
  discoverAuditPaths,
  filterRunsSince,
  rollupAuditJsonl,
  sinceIsoUtc,
} from "../../src/scorecard/aggregate.js";

const root = path.join(process.cwd(), "runs", "_scorecard_test");

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scorecard aggregate", () => {
  it("rollupAuditJsonl counts dry_plan, planner_skipped, hitl + by_step", async () => {
    await mkdir(path.join(root, "r1"), { recursive: true });
    const auditPath = path.join(root, "r1", "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    w.write({ run_id: "r1", step: "planner_branch:start", agent: "p", timestamp: "2026-05-01T12:00:00Z" });
    w.write({ run_id: "r1", step: "planner_skipped", agent: "p", timestamp: "2026-05-01T12:00:01Z" });
    w.write({ run_id: "r1", step: "dry_plan", agent: "p", timestamp: "2026-05-01T12:00:02Z" });
    w.write({
      run_id: "r1",
      step: "hitl_escalation",
      agent: "policy",
      timestamp: "2026-05-01T12:00:03Z",
    });

    const r = rollupAuditJsonl(auditPath);
    expect(r.chain_valid).toBe(true);
    expect(r.dry_plan_count).toBe(1);
    expect(r.o5_skip_count).toBe(1);
    expect(r.hitl_count).toBe(1);
    expect(r.counts_by_step.dry_plan).toBe(1);
    expect(r.counts_by_step.planner_skipped).toBe(1);
    expect(r.counts_by_step.hitl_escalation).toBe(1);
    expect(r.counts_by_step.planner_branch_start).toBeUndefined();
    expect(r.counts_by_step["planner_branch:start"]).toBe(1);
  });

  it("discoverAuditPaths skips _prefix dirs", async () => {
    await mkdir(path.join(root, "_hidden"), { recursive: true });
    await mkdir(path.join(root, "visible"), { recursive: true });
    await writeFile(path.join(root, "_hidden", "audit.jsonl"), '{}\n', "utf8");
    const ap = path.join(root, "visible", "audit.jsonl");
    await writeFile(ap, "", "utf8");
    const found = discoverAuditPaths(root);
    expect(found).toEqual([path.resolve(ap)]);
  });

  it("accumulateTotals merges named counters + chain_breaks", () => {
    const t = accumulateTotals([
      {
        run_id: "a",
        audit_path: "/a",
        chain_valid: true,
        record_count: 1,
        dry_plan_count: 1,
        o5_skip_count: 0,
        hitl_count: 0,
        counts_by_step: { dry_plan: 1 },
        tokens_in_total: 0,
        tokens_out_total: 0,
        started_at: null,
        ended_at: null,
      },
      {
        run_id: "b",
        audit_path: "/b",
        chain_valid: false,
        record_count: 2,
        dry_plan_count: 0,
        o5_skip_count: 1,
        hitl_count: 2,
        counts_by_step: { planner_skipped: 1, hitl_escalation: 2 },
        tokens_in_total: 3,
        tokens_out_total: 4,
        started_at: null,
        ended_at: null,
      },
    ]);
    expect(t.dry_plan_count).toBe(1);
    expect(t.o5_skip_count).toBe(1);
    expect(t.hitl_count).toBe(2);
    expect(t.chain_breaks).toBe(1);
    expect(t.record_count).toBe(3);
    expect(t.tokens_in_total).toBe(3);
    expect(t.tokens_out_total).toBe(4);
    expect(t.counts_by_step.dry_plan).toBe(1);
    expect(t.counts_by_step.planner_skipped).toBe(1);
    expect(t.counts_by_step.hitl_escalation).toBe(2);
  });

  it("sinceIsoUtc + filterRunsSince", () => {
    expect(sinceIsoUtc("2026-05-04")).toBe("2026-05-04T00:00:00.000Z");
    const runs = [
      {
        run_id: "old",
        audit_path: "/",
        chain_valid: true,
        record_count: 1,
        dry_plan_count: 0,
        o5_skip_count: 0,
        hitl_count: 0,
        counts_by_step: {},
        tokens_in_total: 0,
        tokens_out_total: 0,
        started_at: "2026-04-01T00:00:00Z",
        ended_at: "2026-04-30T23:59:59Z",
      },
      {
        run_id: "new",
        audit_path: "/",
        chain_valid: true,
        record_count: 1,
        dry_plan_count: 0,
        o5_skip_count: 0,
        hitl_count: 0,
        counts_by_step: {},
        tokens_in_total: 0,
        tokens_out_total: 0,
        started_at: "2026-05-04T00:00:00Z",
        ended_at: "2026-05-04T01:00:00Z",
      },
    ];
    const cut = sinceIsoUtc("2026-05-04");
    const f = filterRunsSince(runs, cut);
    expect(f.map((x) => x.run_id)).toEqual(["new"]);
  });

  it("buildScorecardModel aggregates discovered paths", async () => {
    await mkdir(path.join(root, "xa"), { recursive: true });
    const p1 = path.join(root, "xa", "audit.jsonl");
    const w = new AuditWriter({ path: p1 });
    w.write({ run_id: "xa", step: "dry_plan", agent: "p", timestamp: "2026-05-10T00:00:00Z" });
    const m = buildScorecardModel(root);
    expect(m.runs).toHaveLength(1);
    expect(m.totals.dry_plan_count).toBe(1);
    expect(m.totals.runs_scanned).toBe(1);
  });
});
