import { z } from "zod";

// ---------- Shared enums ----------

const RunStatus = z.enum([
  "pending",
  "running",
  "paused_for_approval",
  "green",
  "red",
  "budget_exhausted",
  "cycle_aborted",
  "network_unstable",
  "redaction_failure",
  "capability_missing",
]);

const StackId = z.string(); // open-set: 'java-spring' | 'ts-react-vite' | 'ts-node' | …

// ---------- Per-spec snapshot ----------

const SpecSnapshot = z.object({
  slug: z.string(), // YYYY-MM-DD-<feature>
  repo: z.string(), // 'spring-api' | 'react-ui' | 'agent-orchestrator'
  pair_slug: z.string().optional(),
  stack: StackId,
  requirements_path: z.string(),
  tasks_path: z.string(),
  design_path: z.string(),
  hash: z.string(), // sha256 of canonical join of 3 files at run start (edge 36)
});

// ---------- Path ownership (edge 7) ----------

const PathOwnership = z.record(z.string(), z.array(z.string()));

// ---------- Per-gate result ----------

const GateResult = z.object({
  cmd: z.array(z.string()),
  cwd: z.string(),
  exit: z.number(), // 0 pass · 1–125 test fail · >125 infra/timeout
  duration_ms: z.number(),
  truncated_log_path: z.string().optional(),
  partial_log_tail: z.string().optional(), // last 200 lines, edge 3
  oom: z.boolean().default(false), // edge 19
  timed_out: z.boolean().default(false), // edge 3
  parsed: z.record(z.unknown()).optional(),
});

// ---------- Per-LLM call ----------

const LlmCall = z.object({
  agent: z.enum([
    "planner",
    "spring-supervisor",
    "react-supervisor",
    "spring-sub-api",
    "spring-sub-service",
    "react-sub-ui",
    "react-sub-api-client",
    "fix-sub",
    "integration",
    "reviewer",
    "caveman-gate",
  ]),
  model: z.string(),
  tokens_in: z.number(),
  tokens_out: z.number(),
  budget_remaining: z.number(), // O3
  response_id: z.string().optional(),
  structured: z.boolean(), // O1 — true if Zod-validated
  // I4 (task 40): `${runId}:${agentName}:${promptHash}` — TF cache lookup key,
  // also doubles as audit-readable replay marker. Optional: pre-I4 records
  // (planner stub, mock-TF lanes) didn't compute it.
  idempotency_key: z.string().optional(),
  cache_hit: z.boolean().optional(), // true when tfCall short-circuited on replay
});

// ---------- Audit decision ----------

const AuditDecision = z.object({
  step: z.string(),
  agent: z.string(),
  decision: z.string(),
  reason: z.string(),
  timestamp: z.string(),
});

// ---------- Main RunContext ----------

export const RunContext = z.object({
  run_id: z.string(), // UUID per CLI invocation
  started_at: z.string(), // ISO 8601
  cli_flags: z.record(z.unknown()),
  status: RunStatus,

  // Spec inputs (frozen at run start, edge 36)
  specs: z.array(SpecSnapshot),

  // Path ownership (edge 7)
  path_ownership_map: PathOwnership,

  // Cycle guard (edge 32)
  visited_nodes: z.array(z.string()),
  attempt_counter: z.record(z.string(), z.number()),
  max_fix_loops: z.number().default(3), // edge 10
  graph_depth_cap: z.number().default(20), // edge 32

  // Token budget (O3)
  tokens_budget: z.object({
    planner: z.number().default(4000),
    supervisor: z.number().default(8000),
    subagent: z.number().default(16000),
    reviewer: z.number().default(4000),
    integration: z.number().default(4000),
  }),
  tokens_spent: z.record(z.string(), z.number()),
  llm_calls: z.array(LlmCall),

  // Gate booleans (edge 1, 5, 6, 16, 19, 41)
  gate_contract_published: z.boolean().default(false), // edge 1
  gate_coverage_ok: z.boolean().default(false), // edge 5/6
  gate_stryker_scope: z.enum(["none", "diff", "full"]).default("none"), // edge 6
  gate_lint_clean: z.boolean().default(false), // edge 41
  gate_oom: z.boolean().default(false), // edge 19

  // Per-repo + per-gate exits
  api_exit: z.number().optional(),
  ui_exit: z.number().optional(),
  orch_exit: z.number().optional(),
  gates: z.record(z.string(), GateResult),

  // Capability probe (edge 45)
  tf_capabilities: z
    .object({
      structured_output: z.boolean(),
      tool_use: z.boolean(),
    })
    .optional(),

  // Approval boundary (G4)
  pending_diff_paths: z.array(z.string()),
  approvals: z.array(
    z.object({
      supervisor: z.string(),
      approved: z.boolean(),
      reason: z.string().optional(),
      diff_hash: z.string(),
      timestamp: z.string(),
    }),
  ),

  // Audit (G5)
  audit_path: z.string(), // runs/<id>/audit.jsonl
  prev_hash: z.string(), // last record hash for chaining

  // Decisions surfaced mid-run
  audit_decisions: z.array(AuditDecision),

  // State snapshot (edge 11). Inngest path owns true resume via event re-emit
  // w/ same id (task 45); state.json is a debug + local-mock-CLI artifact only.
  state_file_path: z.string(), // runs/<id>/state.json
  worktree_hash: z.string().optional(), // edge 44 — recorded after each gate
});

export type RunContextT = z.infer<typeof RunContext>;
export type SpecSnapshotT = z.infer<typeof SpecSnapshot>;
