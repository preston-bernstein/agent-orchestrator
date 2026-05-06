import { describe, expect, it } from "vitest";
import { accumulateTotals } from "../../src/scorecard/aggregate.js";

describe("scorecard phase2 trigger totals", () => {
  it("accumulateTotals: O7 phase_2_eligible flips on green_pct + avg_fix_loops + chain_breaks", () => {
    const greenA = (id: string, fix = 0): Parameters<typeof accumulateTotals>[0][number] => ({
      run_id: id,
      audit_path: "/x",
      chain_valid: true,
      record_count: 1,
      dry_plan_count: 0,
      o5_skip_count: 0,
      hitl_count: 0,
      counts_by_step: {},
      tokens_in_total: 0,
      tokens_out_total: 0,
      started_at: null,
      ended_at: null,
      scenario: "A",
      green: true,
      fix_loops: fix,
      approval_approved_count: 0,
      approval_rejected_count: 0,
      approval_timeout_count: 0,
      approval_latency_ms_avg: null,
    });

    const fivePass = accumulateTotals([greenA("r1"), greenA("r2"), greenA("r3"), greenA("r4"), greenA("r5")]);
    expect(fivePass.green_pct).toBe(100);
    expect(fivePass.avg_fix_loops).toBe(0);
    expect(fivePass.phase_2_eligible).toBe(true);

    const oneRedFour = accumulateTotals([
      greenA("r1"),
      greenA("r2"),
      greenA("r3"),
      greenA("r4"),
      { ...greenA("r5"), green: false },
    ]);
    expect(oneRedFour.green_pct).toBe(80);
    expect(oneRedFour.phase_2_eligible).toBe(true);

    const noisyFix = accumulateTotals([greenA("r1", 2), greenA("r2", 2), greenA("r3", 2)]);
    expect(noisyFix.avg_fix_loops).toBe(2);
    expect(noisyFix.phase_2_eligible).toBe(false);

    const chainBroken = accumulateTotals([{ ...greenA("r1"), chain_valid: false, green: false }]);
    expect(chainBroken.chain_breaks).toBe(1);
    expect(chainBroken.phase_2_eligible).toBe(false);

    const empty = accumulateTotals([]);
    expect(empty.runs_scanned).toBe(0);
    expect(empty.phase_2_eligible).toBe(false);
  });
});
