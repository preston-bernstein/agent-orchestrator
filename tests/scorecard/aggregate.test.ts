import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

describe("scorecard aggregate — rollup + discovery", () => {
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
});

describe("scorecard aggregate — totals merge", () => {
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
        scenario: "unknown",
        green: false,
        fix_loops: 0,
        approval_approved_count: 0,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: null,
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
        scenario: "E",
        green: false,
        fix_loops: 0,
        approval_approved_count: 0,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: null,
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
});

describe("scorecard aggregate — filter since", () => {
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
        scenario: "unknown" as const,
        green: false,
        fix_loops: 0,
        approval_approved_count: 0,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: null,
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
        scenario: "unknown" as const,
        green: false,
        fix_loops: 0,
        approval_approved_count: 0,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: null,
      },
    ];
    const cut = sinceIsoUtc("2026-05-04");
    const f = filterRunsSince(runs, cut);
    expect(f.map((x) => x.run_id)).toEqual(["new"]);
  });
});

describe("scorecard aggregate — edge parsing", () => {
  it("sinceIsoUtc rejects non YYYY-MM-DD", () => {
    expect(() => sinceIsoUtc("2026/05/04")).toThrow(/--since expects YYYY-MM-DD/);
  });

  it("rollupAuditJsonl handles missing audit file (empty parse + broken chain)", () => {
    const p = path.join(root, "nope", "audit.jsonl");
    const r = rollupAuditJsonl(p);
    expect(r.chain_valid).toBe(false);
    expect(r.record_count).toBe(0);
    expect(r.scenario).toBe("unknown");
    expect(r.green).toBe(false);
  });

  it("filterRunsSince keeps runs with ended_at null", () => {
    const cut = sinceIsoUtc("2026-05-04");
    const runs = [
      {
        run_id: "open",
        audit_path: "/",
        chain_valid: true,
        record_count: 1,
        dry_plan_count: 0,
        o5_skip_count: 0,
        hitl_count: 0,
        counts_by_step: {},
        tokens_in_total: 0,
        tokens_out_total: 0,
        started_at: "2026-05-05T00:00:00Z",
        ended_at: null as string | null,
        scenario: "unknown" as const,
        green: false,
        fix_loops: 0,
        approval_approved_count: 0,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: null,
      },
    ];
    expect(filterRunsSince(runs, cut)).toHaveLength(1);
  });

  it("parseRollupLines picks earliest started_at and latest ended_at", async () => {
    await mkdir(path.join(root, "tsorder"), { recursive: true });
    const ap = path.join(root, "tsorder", "audit.jsonl");
    const w = new AuditWriter({ path: ap });
    w.write({ run_id: "tsorder", step: "boot", agent: "x", timestamp: "2026-05-04T02:00:00Z" });
    w.write({ run_id: "tsorder", step: "dry_plan", agent: "p", timestamp: "2026-05-04T00:00:00Z" });
    const r = rollupAuditJsonl(ap);
    expect(r.chain_valid).toBe(true);
    expect(r.started_at).toBe("2026-05-04T00:00:00Z");
    expect(r.ended_at).toBe("2026-05-04T02:00:00Z");
  });

  it("parseRollupLines skips invalid JSON lines (ledger still sums parseable rows)", async () => {
    await mkdir(path.join(root, "badline"), { recursive: true });
    const ap = path.join(root, "badline", "audit.jsonl");
    const w = new AuditWriter({ path: ap });
    w.write({ run_id: "badline", step: "dry_plan", agent: "p", timestamp: "2026-05-04T00:00:00Z" });
    const body = await readFile(ap, "utf8");
    await writeFile(ap, `${body.trimEnd()}\nnot-json{`, "utf8");
    const r = rollupAuditJsonl(ap);
    expect(r.chain_valid).toBe(false);
    expect(r.dry_plan_count).toBe(1);
    expect(r.record_count).toBe(2);
  });
});

describe("scorecard aggregate — supervisor parse + model", () => {
  it("supervisor_spawn agent must match *-supervisor; non-done status ⇒ not green", async () => {
    await mkdir(path.join(root, "sup-parse"), { recursive: true });
    const ap = path.join(root, "sup-parse", "audit.jsonl");
    const w = new AuditWriter({ path: ap });
    w.write({
      run_id: "sup-parse",
      step: "supervisor_spawn",
      agent: "mystery",
      timestamp: "2026-05-04T00:00:00Z",
    });
    w.write({
      run_id: "sup-parse",
      step: "supervisor_done",
      agent: "mystery",
      decisions: ["status=pending", "next=halt"],
      timestamp: "2026-05-04T00:00:01Z",
    });
    const r = rollupAuditJsonl(ap);
    expect(r.scenario).toBe("unknown");
    expect(r.green).toBe(false);
  });

  it("buildScorecardModel honors explicit auditPaths list", async () => {
    await mkdir(path.join(root, "x1"), { recursive: true });
    await mkdir(path.join(root, "x2"), { recursive: true });
    const p1 = path.join(root, "x1", "audit.jsonl");
    const p2 = path.join(root, "x2", "audit.jsonl");
    const w1 = new AuditWriter({ path: p1 });
    w1.write({ run_id: "x1", step: "dry_plan", agent: "p", timestamp: "2026-05-04T00:00:00Z" });
    const w2 = new AuditWriter({ path: p2 });
    w2.write({ run_id: "x2", step: "dry_plan", agent: "p", timestamp: "2026-05-04T00:00:00Z" });
    const m = buildScorecardModel(root, [path.resolve(p2)]);
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0]?.run_id).toBe("x2");
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

async function writeScenarioAuditRun(
  runRoot: string,
  runId: string,
  write: (w: AuditWriter) => void,
): Promise<string> {
  await mkdir(path.join(runRoot, runId), { recursive: true });
  const auditPath = path.join(runRoot, runId, "audit.jsonl");
  const w = new AuditWriter({ path: auditPath });
  write(w);
  return auditPath;
}

/**
 * Scenario classifier + O7 numeric trigger.
 * Vault canon: `Build/Patterns/O7-phase2-numeric-trigger.md`;
 * `Orchestration PoC Demo Scorecard.md` (scenarios A–E).
 */
describe("scorecard scenario inference — A–E core", () => {
  it("planner_skipped classifies as Scenario E + green=true (skip is a no-op success)", async () => {
    const ap = await writeScenarioAuditRun(root, "e-skip", (w) => {
      w.write({ run_id: "e-skip", step: "planner_branch:start", agent: "system", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "e-skip", step: "planner_skipped", agent: "planner", decisions: ["all tasks checked, tree clean, no pending fixes"], timestamp: "2026-05-04T00:00:01Z" });
    });
    const r = rollupAuditJsonl(ap);
    expect(r.scenario).toBe("E");
    expect(r.green).toBe(true);
    expect(r.fix_loops).toBe(0);
  });

  it("single spring supervisor + no integration ⇒ Scenario A; explicit scenario=D tag overrides", async () => {
    const apA = await writeScenarioAuditRun(root, "a-only-spring", (w) => {
      w.write({ run_id: "a-only-spring", step: "supervisor_spawn", agent: "spring-supervisor", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "a-only-spring", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "a-only-spring", step: "supervisor_done", agent: "spring-supervisor", decisions: ["status=done", "next=ready_for_review"], timestamp: "2026-05-04T00:00:02Z" });
    });
    const rA = rollupAuditJsonl(apA);
    expect(rA.scenario).toBe("A");
    expect(rA.green).toBe(true);
    expect(rA.fix_loops).toBe(0);

    const apD = await writeScenarioAuditRun(root, "d-with-tag", (w) => {
      w.write({ run_id: "d-with-tag", step: "scenario_tag", agent: "system", decisions: ["scenario=D"], timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "d-with-tag", step: "supervisor_spawn", agent: "spring-supervisor", timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "d-with-tag", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:02Z" });
      w.write({ run_id: "d-with-tag", step: "supervisor_done", agent: "spring-supervisor", decisions: ["status=done"], timestamp: "2026-05-04T00:00:03Z" });
    });
    const rD = rollupAuditJsonl(apD);
    expect(rD.scenario).toBe("D");
    expect(rD.green).toBe(true);
  });

  it("single react supervisor ⇒ Scenario B", async () => {
    const ap = await writeScenarioAuditRun(root, "b-react", (w) => {
      w.write({ run_id: "b-react", step: "supervisor_spawn", agent: "react-supervisor", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "b-react", step: "gate_invocation", agent: "react-supervisor", cmd: ["pnpm"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "b-react", step: "supervisor_done", agent: "react-supervisor", decisions: ["status=done"], timestamp: "2026-05-04T00:00:02Z" });
    });
    const r = rollupAuditJsonl(ap);
    expect(r.scenario).toBe("B");
    expect(r.green).toBe(true);
  });
});

describe("scorecard scenario inference — cross-repo + guards", () => {
  it("two supervisors + integration_run ⇒ Scenario C", async () => {
    const ap = await writeScenarioAuditRun(root, "c-cross", (w) => {
      w.write({ run_id: "c-cross", step: "supervisor_spawn", agent: "spring-supervisor", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "c-cross", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "c-cross", step: "supervisor_done", agent: "spring-supervisor", decisions: ["status=done"], timestamp: "2026-05-04T00:00:02Z" });
      w.write({ run_id: "c-cross", step: "supervisor_spawn", agent: "react-supervisor", timestamp: "2026-05-04T00:00:03Z" });
      w.write({ run_id: "c-cross", step: "gate_invocation", agent: "react-supervisor", cmd: ["pnpm"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:04Z" });
      w.write({ run_id: "c-cross", step: "supervisor_done", agent: "react-supervisor", decisions: ["status=done"], timestamp: "2026-05-04T00:00:05Z" });
      w.write({ run_id: "c-cross", step: "integration_run", agent: "integration", decisions: ["status=compatible", "recommended=proceed"], timestamp: "2026-05-04T00:00:06Z" });
    });
    const r = rollupAuditJsonl(ap);
    expect(r.scenario).toBe("C");
    expect(r.green).toBe(true);
  });

  it("supervisor_blocked ⇒ green=false; chain break ⇒ green=false; fix_loops counts gates beyond first", async () => {
    const ap = await writeScenarioAuditRun(root, "blocked", (w) => {
      w.write({ run_id: "blocked", step: "supervisor_spawn", agent: "react-supervisor", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "blocked", step: "supervisor_blocked", agent: "react-supervisor", decisions: ["block_for_contract"], timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "blocked", step: "supervisor_done", agent: "react-supervisor", decisions: ["status=blocked_on_contract"], timestamp: "2026-05-04T00:00:02Z" });
    });
    const r = rollupAuditJsonl(ap);
    expect(r.green).toBe(false);

    const apFix = await writeScenarioAuditRun(root, "a-fix-loops", (w) => {
      w.write({ run_id: "a-fix-loops", step: "supervisor_spawn", agent: "spring-supervisor", timestamp: "2026-05-04T00:00:00Z" });
      w.write({ run_id: "a-fix-loops", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 1, timestamp: "2026-05-04T00:00:01Z" });
      w.write({ run_id: "a-fix-loops", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 1, timestamp: "2026-05-04T00:00:02Z" });
      w.write({ run_id: "a-fix-loops", step: "gate_invocation", agent: "spring-supervisor", cmd: ["mvn"], cwd: "/x", exit: 0, timestamp: "2026-05-04T00:00:03Z" });
      w.write({ run_id: "a-fix-loops", step: "supervisor_done", agent: "spring-supervisor", decisions: ["status=done"], timestamp: "2026-05-04T00:00:04Z" });
    });
    const rFix = rollupAuditJsonl(apFix);
    expect(rFix.scenario).toBe("A");
    expect(rFix.fix_loops).toBe(2);
    expect(rFix.green).toBe(true);
  });
});
