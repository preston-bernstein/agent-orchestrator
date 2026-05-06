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

describe("mergeRollupRow", () => {
  it("ignores rows without step", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, {});
    mergeRollupRow(acc, { step: 1 });
    expect(acc.counts_by_step).toEqual({});
  });

  it("rolls run_id, timestamps widen window, sums tokens_in/out", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, {
      step: "planner_branch:start",
      run_id: "r99",
      timestamp: "2026-05-03T01:00:00Z",
      tokens_in: 2,
      tokens_out: 3,
    });
    mergeRollupRow(acc, {
      step: "planner_branch:end",
      timestamp: "2026-05-03T03:00:00Z",
    });
    expect(acc.run_id).toBe("r99");
    expect(acc.started_at).toBe("2026-05-03T01:00:00Z");
    expect(acc.ended_at).toBe("2026-05-03T03:00:00Z");
    expect(acc.tokens_in_total).toBe(2);
    expect(acc.tokens_out_total).toBe(3);
    expect(acc.counts_by_step["planner_branch:start"]).toBe(1);
  });

  it("ignores non-finite tokens", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, {
      step: "x",
      tokens_in: Number.NaN,
      tokens_out: Number.POSITIVE_INFINITY,
    });
    expect(acc.tokens_in_total).toBe(0);
    expect(acc.tokens_out_total).toBe(0);
  });
});

describe("mergeRollupRow supervisor and token slices", () => {
  it("appends decisions + supervisor_spawn id + supervisor_done status", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, {
      step: "supervisor_spawn",
      agent: "spring-supervisor",
      decisions: ["foo"],
    });
    mergeRollupRow(acc, {
      step: "supervisor_done",
      decisions: ["status=done", "other"],
    });
    expect(acc.supervisorIds).toEqual(["spring"]);
    expect(acc.supervisorDoneOutcomes).toEqual(["done"]);
    expect(acc.decisionTokens).toEqual(["foo", "status=done", "other"]);
  });

  it("supervisor_spawn without -supervisor pattern does not capture id", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, { step: "supervisor_spawn", agent: "nope" });
    expect(acc.supervisorIds).toEqual([]);
  });

  it("supervisor_done without status token skips outcome slice", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, { step: "supervisor_done", decisions: ["nope"] });
    expect(acc.supervisorDoneOutcomes).toEqual([]);
  });

  it("marks supervisor_blocked", () => {
    const acc = emptyAccum();
    mergeRollupRow(acc, { step: "supervisor_blocked" });
    expect(acc.hasSupervisorBlocked).toBe(true);
  });
});

