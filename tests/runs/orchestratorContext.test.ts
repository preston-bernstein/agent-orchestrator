import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrchestratorContext,
  initRunContext,
} from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson, readJson } from "../../src/runs/state.js";

const tmp = path.join(process.cwd(), "runs", "_test_orch_ctx");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const baseSnapshot = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "15079571ebd9d52fcf77dd84ff06f67d69d3b941",
  vault_cut_date: "2026-05-04",
  playbook_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook.md",
};

describe("OrchestratorContext schema (SF1 task 23 — A3)", () => {
  it("extend()s base RunContext w/ expectations_snapshot field", () => {
    const ctx = initRunContext({
      run_id: "11111111-2222-3333-4444-555555555555",
      started_at: "2026-05-04T08:00:00Z",
      cli_flags: { execute: false },
      expectations_snapshot: baseSnapshot,
      audit_path: "runs/x/audit.jsonl",
      state_file_path: "runs/x/state.json",
    });
    expect(ctx.expectations_snapshot.vault_git_sha).toBe(baseSnapshot.vault_git_sha);
    expect(ctx.expectations_snapshot.docSha256.length).toBe(64);
    // base schema defaults still applied (G1 + O3)
    expect(ctx.max_fix_loops).toBe(3);
    expect(ctx.tokens_budget.subagent).toBe(16000);
    expect(ctx.status).toBe("pending");
  });

  it("rejects ctx missing expectations_snapshot (A3 enforcement)", () => {
    const bad = {
      run_id: "id",
      started_at: "t",
      cli_flags: {},
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
      audit_path: "a",
      prev_hash: "0".repeat(64),
      audit_decisions: [],
      state_file_path: "s",
    };
    expect(() => OrchestratorContext.parse(bad)).toThrow();
  });
});

describe("initRunContext + atomicWriteJson roundtrip", () => {
  it("persists snapshot into runs/<id>/state.json + reparses cleanly", () => {
    const statePath = path.join(tmp, "state.json");
    const ctx = initRunContext({
      run_id: "abc",
      started_at: "2026-05-04T09:00:00Z",
      cli_flags: { dry_plan: true },
      expectations_snapshot: baseSnapshot,
      audit_path: path.join(tmp, "audit.jsonl"),
      state_file_path: statePath,
    });
    atomicWriteJson({ path: statePath, data: ctx });
    const loaded = readJson(statePath);
    const reparsed = OrchestratorContext.parse(loaded);
    expect(reparsed.expectations_snapshot.vault_git_sha).toBe(
      baseSnapshot.vault_git_sha,
    );
    expect(reparsed.run_id).toBe("abc");
    expect(reparsed.cli_flags).toEqual({ dry_plan: true });
  });
});
