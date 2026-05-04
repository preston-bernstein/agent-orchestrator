import { describe, expect, it } from "vitest";
import { RunContext } from "../../src/runs/RunContext.js";

const minimalCtx = {
  run_id: "11111111-2222-3333-4444-555555555555",
  started_at: "2026-05-04T08:00:00Z",
  cli_flags: { execute: false },
  status: "pending",
  specs: [],
  path_ownership_map: {},
  visited_nodes: [],
  attempt_counter: {},
  tokens_budget: {},
  tokens_spent: {},
  llm_calls: [],
  gates: {},
  pending_diff_paths: [],
  approvals: [],
  audit_path: "runs/x/audit.jsonl",
  prev_hash: "0".repeat(64),
  audit_decisions: [],
  state_file_path: "runs/x/state.json",
};

describe("RunContext schema", () => {
  it("parses a minimal valid ctx and applies defaults (G1 fix)", () => {
    const parsed = RunContext.parse(minimalCtx);
    expect(parsed.max_fix_loops).toBe(3); // edge 10
    expect(parsed.graph_depth_cap).toBe(20); // edge 32
    expect(parsed.gate_contract_published).toBe(false); // edge 1
    expect(parsed.gate_stryker_scope).toBe("none"); // edge 6
    expect(parsed.tokens_budget.planner).toBe(4000); // O3
    expect(parsed.tokens_budget.subagent).toBe(16000); // O3
  });

  it("rejects unknown status (open-set guarded by enum)", () => {
    expect(() => RunContext.parse({ ...minimalCtx, status: "shipped" })).toThrow();
  });

  it("requires audit_path + prev_hash + state_file_path (G5 + edge 11/44)", () => {
    const noAudit = { ...minimalCtx } as Record<string, unknown>;
    delete noAudit.audit_path;
    expect(() => RunContext.parse(noAudit)).toThrow();
  });
});
