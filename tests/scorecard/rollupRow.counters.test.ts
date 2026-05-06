import { describe, expect, it } from "vitest";
import type { NamedCountersSlice, RollupAccumShape } from "../../src/scorecard/rollupRow.js";
import { mergeRollupRow } from "../../src/scorecard/rollupRow.js";

function emptyAccum(): RollupAccumShape {
  return {
    run_id: "r0",
    named: emptyNamed(),
    counts_by_step: {},
    tokens_in_total: 0,
    tokens_out_total: 0,
    started_at: null,
    ended_at: null,
    decisionTokens: [],
    supervisorIds: [],
    supervisorDoneOutcomes: [],
    hasSupervisorBlocked: false,
  };
}

function emptyNamed(): NamedCountersSlice {
  return { dry_plan_count: 0, o5_skip_count: 0, hitl_count: 0 };
}

describe("mergeRollupRow counters and decision parsing", () => {
  it("bumpNamed counters for dry_plan, planner_skipped, hitl", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, { step: "dry_plan" });
    mergeRollupRow(acc, { step: "planner_skipped" });
    mergeRollupRow(acc, { step: "hitl_escalation" });
    expect(acc.named.dry_plan_count).toBe(1);
    expect(acc.named.o5_skip_count).toBe(1);
    expect(acc.named.hitl_count).toBe(1);
  });

  it("parses decisions arrays — only strings kept", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, { step: "a", decisions: ["ok"] });
    mergeRollupRow(acc, {
      step: "b",
      decisions: [{ x: 1 }, null, "tok"] as unknown as string[],
    });
    expect(acc.decisionTokens).toEqual(["ok", "tok"]);
  });
});
