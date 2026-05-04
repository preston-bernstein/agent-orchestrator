import { z } from "zod";
import {
  ExpectationsSnapshotSchema,
  type ExpectationsSnapshot,
} from "../config/expectations.js";
import { ZERO_HASH } from "../audit/jsonl.js";
import { RunContext, type RunContextT } from "./RunContext.js";

/**
 * Orchestrator-specific extension of vault canonical RunContext.
 *
 * Vault rule (Build/RunContext.md §"Rules for evolving the schema"):
 *   "Stack-specific extensions live in `src/runs/<stack>Context.ts` w/
 *    `extend()`; never bloat the base schema."
 *
 * Adds A3 expectations snapshot so every run records which vault canon sha
 * the orchestrator was running against at boot. Persisted into
 * runs/<run_id>/state.json on run init (SF1 task 23).
 */
export const OrchestratorContext = RunContext.extend({
  expectations_snapshot: ExpectationsSnapshotSchema,
});
export type OrchestratorContextT = z.infer<typeof OrchestratorContext>;

export interface InitRunContextInput {
  run_id: string;
  started_at: string;
  cli_flags: Record<string, unknown>;
  expectations_snapshot: ExpectationsSnapshot;
  audit_path: string;
  state_file_path: string;
}

/**
 * Build a fresh OrchestratorContext seed for a new run. Defaults flow from
 * the base RunContext schema (e.g. `max_fix_loops=3`, `tokens_budget.*`).
 * Caller persists via `atomicWriteJson` after this returns.
 */
export function initRunContext(input: InitRunContextInput): OrchestratorContextT {
  const seed: RunContextT & { expectations_snapshot: ExpectationsSnapshot } =
    OrchestratorContext.parse({
      run_id: input.run_id,
      started_at: input.started_at,
      cli_flags: input.cli_flags,
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
      audit_path: input.audit_path,
      prev_hash: ZERO_HASH,
      audit_decisions: [],
      state_file_path: input.state_file_path,
      expectations_snapshot: input.expectations_snapshot,
    });
  return seed;
}
