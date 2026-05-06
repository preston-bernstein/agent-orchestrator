import { describe, expect, it } from "vitest";
import { renderScorecardMarkdown } from "../../src/scorecard/format.js";
import type { ScorecardModel } from "../../src/scorecard/aggregate.js";

describe("scorecard/format", () => {
  it("renders approval counters and latency in totals + per-run rows", () => {
    const model: ScorecardModel = {
      runs_dir: "/tmp/runs",
      generated_at: "2026-05-06T00:00:00.000Z",
      runs: [
        {
          run_id: "r1",
          audit_path: "/tmp/runs/r1/audit.jsonl",
          chain_valid: true,
          record_count: 3,
          counts_by_step: {
            approval_prompt_written: 1,
            approval_decision: 1,
          },
          dry_plan_count: 0,
          o5_skip_count: 0,
          hitl_count: 0,
          tokens_in_total: 0,
          tokens_out_total: 0,
          started_at: "2026-05-06T00:00:00.000Z",
          ended_at: "2026-05-06T00:00:10.000Z",
          scenario: "A",
          green: true,
          fix_loops: 0,
          approval_approved_count: 1,
          approval_rejected_count: 0,
          approval_timeout_count: 0,
          approval_latency_ms_avg: 2500,
        },
      ],
      totals: {
        runs_scanned: 1,
        record_count: 3,
        tokens_in_total: 0,
        tokens_out_total: 0,
        chain_breaks: 0,
        counts_by_step: { approval_decision: 1 },
        dry_plan_count: 0,
        o5_skip_count: 0,
        hitl_count: 0,
        green_count: 1,
        green_pct: 100,
        avg_fix_loops: 0,
        scenarios_seen: { A: 1, B: 0, C: 0, D: 0, E: 0, unknown: 0 },
        phase_2_eligible: true,
        approval_approved_count: 1,
        approval_rejected_count: 0,
        approval_timeout_count: 0,
        approval_latency_ms_avg: 2500,
      },
    };
    const md = renderScorecardMarkdown(model);
    expect(md).toContain("approvals: approved=1, rejected=0, timeout=0");
    expect(md).toContain("approval_latency_ms_avg: 2500");
    expect(md).toContain("| r1 | A | yes | 0 | 1/0/0 | 2500 |");
  });
});

