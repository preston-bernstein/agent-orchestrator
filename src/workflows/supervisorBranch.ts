import { AuditWriter } from "../audit/jsonl.js";
import type { AssembledPrompt } from "../llm/assemblePrompt.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { PlannerOutputT, PlannerTaskT } from "../agents/planner.schema.js";
import type { RunSupervisorInput } from "../agents/supervisor.js";
import {
  runSupervisor,
  type RunSupervisorResult,
} from "../agents/supervisor.js";
import { getStackProfile } from "../stacks/index.js";
import type { StackProfile } from "../stacks/types.js";
import type { GateInvocation, RunQualityDeps } from "../gates/runQuality.js";

/**
 * Supervisor dispatch. Reads `PlannerOutput`, groups tasks by supervisor
 * (`spring` | `react` | `orch`), runs each supervisor in canonical order
 * w/ API-first edge lock (Phase 6).
 *
 * Vault canon: `Build/Playbook.md` §Phase 5–6; `Build/Prompts/supervisor-base.md`;
 * `Multi-Agent Orchestration PoC` §Edge cases #1 (API-first contract gate).
 *
 * Ordering (Phase 6): `spring` → `react` → `orch` → others (alpha). Producer
 * always runs before consumer so `gate_contract_published` can flip true
 * before downstream supervisors read it.
 *
 * API-first edge lock (Phase 6, edge 1):
 *   - After each supervisor completes, scan its green tasks for
 *     `contract_artifact` set ⇒ flip `gateContractPublished = true`.
 *   - Before each subsequent supervisor, if any of its tasks declares
 *     `consumes_contract` AND `gateContractPublished === false` ⇒ skip
 *     LLM/gate; emit `block_for_contract` w/ `next_action: 'wait_for_contract'`.
 *     Vault canon: supervisor-base §Output `status: block_for_contract`.
 *
 * Audit events emitted:
 *   - `supervisor_spawn` — once per supervisor; `decisions` lists task ids.
 *   - `supervisor_blocked` — block_for_contract path (no subagent spawn).
 *   - `gate_invocation` — one per `runQuality` call (cmd + exit + tail digest).
 *   - `supervisor_done` — final status + `pending_diff_path` when present.
 *
 * Aggregate adds `blocked_on_contract` (Phase 6) — caller (`runIntegrationStep`)
 * skips integration when blocked.
 *
 * Known gaps:
 *   - No real `git apply` to managed working tree (in-memory patch journal
 *     only). `pending_diff_path` is the merged-string artifact; Phase 7
 *     Approval reads it.
 *   - No cross-supervisor parallelism (still sequential; Inngest absorbs
 *     durability + parallelism per ADR 0003).
 *   - No Inngest durability (tasks 35–46, HITL-gated).
 */

interface SupervisorBranchInput {
  ctx: OrchestratorContextT;
  plan: PlannerOutputT;
  /** Override `runs/<run_id>/` dir (tests). */
  runDir?: string;
  /** Inject existing audit writer (tests pre-construct). */
  auditWriter?: AuditWriter;
  /** Map supervisor id → managed-repo cwd. Tests inject a tmp dir. */
  cwds: Readonly<Record<string, string>>;
  /** Map stack id → overlay text (subagent prompt append). Optional. */
  stackOverlays?: Readonly<Record<string, string>>;
}

interface SupervisorBranchDeps {
  subagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  fixSubagentCompletion: (prompt: AssembledPrompt) => Promise<unknown>;
  exec?: RunQualityDeps["exec"];
  estimateTokens?: (kind: "supervisor" | "subagent" | "fix-subagent") => number;
}

export interface SupervisorBranchResult {
  supervisors: readonly {
    supervisorId: string;
    stack: string;
    result: RunSupervisorResult;
  }[];
  /** Aggregate run-level status: green if every supervisor done; else first non-green. */
  aggregateStatus:
    | "green"
    | "red"
    | "needs_human_clarify"
    | "budget_exhausted"
    | "blocked_on_contract";
  /**
   * Phase 6 — set true if any green producer task in this run published a
   * `contract_artifact`. Caller (`runIntegrationStep`) reads this to decide
   * whether to invoke the integration agent.
   */
  gate_contract_published: boolean;
  /**
   * Producer tasks that landed green w/ a `contract_artifact` declared.
   * `runIntegrationStep` picks first entry to hash. Empty when no producer.
   */
  contract_producers: readonly {
    supervisorId: string;
    taskId: string;
    contractArtifact: string;
  }[];
}

export class UnknownSupervisorCwd extends Error {
  constructor(public readonly supervisorId: string) {
    super(
      `no cwd registered for supervisor '${supervisorId}' — pass cwds[${supervisorId}] in SupervisorBranchInput`,
    );
    this.name = "UnknownSupervisorCwd";
  }
}

/**
 * Canonical supervisor order (Phase 6). Producers (API) precede consumers
 * (UI) so `gate_contract_published` can flip true before the consumer
 * supervisor reads it (edge 1 — API-first). Unknown supervisor ids fall
 * through to alpha sort.
 */
const SUPERVISOR_ORDER: readonly string[] = ["spring", "react", "orch"];

export function compareSupervisorIds(a: string, b: string): number {
  const ai = SUPERVISOR_ORDER.indexOf(a);
  const bi = SUPERVISOR_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

function groupBySupervisor(
  plan: PlannerOutputT,
): { supId: string; tasks: PlannerTaskT[] }[] {
  const map = new Map<string, PlannerTaskT[]>();
  for (const t of plan.tasks) {
    const list = map.get(t.supervisor) ?? [];
    list.push(t);
    map.set(t.supervisor, list);
  }
  return [...map.entries()]
    .map(([supId, tasks]) => ({ supId, tasks }))
    .sort((x, y) => compareSupervisorIds(x.supId, y.supId));
}

/**
 * Resolve stack id for a supervisor.
 *
 * Phase 5 hard-coding kept for the deterministic supervisor-branch path:
 *   spring → java-spring, react → ts-react-vite, orch → ts-node.
 *
 * Phase 6: `runExecuteLane` already reads stack-per-repo from `_meta.md`
 * (vault canon — `loadManagedRepos` returns `{ profile }`). For now this
 * function operates on supervisor id only (works as long as managed repo's
 * declared stack matches the canonical mapping). Promotion to read
 * `repos[supId].meta.stack` lands when a non-canonical mapping shows up
 * (e.g. ts-node react preview) + an ADR pins the override.
 */
function stackForSupervisor(supId: string): string {
  switch (supId) {
    case "spring":
      return "java-spring";
    case "react":
      return "ts-react-vite";
    case "orch":
      return "ts-node";
    default:
      return supId;
  }
}

function contractBlockedSupervisorResult(
  ctx: OrchestratorContextT,
  supId: string,
  stackId: string,
  tasks: PlannerTaskT[],
  consumerTasks: PlannerTaskT[],
  readVisited: readonly string[],
): RunSupervisorResult {
  return {
    output: {
      status: "block_for_contract",
      rationale: `awaiting contract publish from upstream producer (${consumerTasks.length} consumer task(s))`.slice(
        0,
        200,
      ),
      task_results: tasks.map((t) => ({
        task_id: t.id,
        state: "skipped",
        fix_loop_count: 0,
        notes: t.consumes_contract
          ? `block_for_contract: ${t.consumes_contract}`
          : "skipped — supervisor blocked",
      })),
      next_action: "wait_for_contract",
      fix_targets: [],
    },
    visited_nodes: readVisited,
    attempt_counter: { ...ctx.attempt_counter },
    tokens_delta: { supervisor: 0, subagent: 0, "fix-subagent": 0 },
    gate_history: [],
    patches: [],
  };
}

function recordContractProducers(
  taskResults: RunSupervisorResult["output"]["task_results"],
  tasks: PlannerTaskT[],
  supId: string,
  contractProducers: {
    supervisorId: string;
    taskId: string;
    contractArtifact: string;
  }[],
  gatePublished: { current: boolean },
): void {
  for (const tr of taskResults) {
    if (tr.state !== "green") continue;
    const planTask = tasks.find((t) => t.id === tr.task_id);
    if (planTask?.contract_artifact) {
      gatePublished.current = true;
      contractProducers.push({
        supervisorId: supId,
        taskId: planTask.id,
        contractArtifact: planTask.contract_artifact,
      });
    }
  }
}

function aggregateEarlyExitFromTaskStatus(
  s: RunSupervisorResult["output"]["status"],
): SupervisorBranchResult["aggregateStatus"] | null {
  if (s === "needs_human_clarify") return "needs_human_clarify";
  if (s === "budget_exhausted") return "budget_exhausted";
  if (s === "block_for_contract") return "blocked_on_contract";
  return null;
}

function aggregateStatusFromResults(
  results: readonly {
    supervisorId: string;
    stack: string;
    result: RunSupervisorResult;
  }[],
): SupervisorBranchResult["aggregateStatus"] {
  let aggregate: SupervisorBranchResult["aggregateStatus"] = "green";
  for (const r of results) {
    const s = r.result.output.status;
    const early = aggregateEarlyExitFromTaskStatus(s);
    if (early) return early;
    if (s !== "done") aggregate = "red";
  }
  return aggregate;
}

interface BranchLoopState {
  visited: string[];
  gateContractPublished: boolean;
  contractProducers: {
    supervisorId: string;
    taskId: string;
    contractArtifact: string;
  }[];
  results: {
    supervisorId: string;
    stack: string;
    result: RunSupervisorResult;
  }[];
}

async function runSupervisorGroupBlocked(
  ctx: OrchestratorContextT,
  supId: string,
  stackId: string,
  tasks: PlannerTaskT[],
  consumerTasks: PlannerTaskT[],
  st: BranchLoopState,
  audit: AuditWriter,
): Promise<void> {
  audit.write({
    run_id: ctx.run_id,
    step: "supervisor_blocked",
    agent: `${supId}-supervisor`,
    decisions: [
      `reason=block_for_contract`,
      `consumer_tasks=${consumerTasks.map((t) => t.id).join(",")}`,
      `stack=${stackId}`,
    ],
    timestamp: new Date().toISOString(),
  });
  const blockedResult = contractBlockedSupervisorResult(
    ctx,
    supId,
    stackId,
    tasks,
    consumerTasks,
    st.visited,
  );
  audit.write({
    run_id: ctx.run_id,
    step: "supervisor_done",
    agent: `${supId}-supervisor`,
    decisions: [
      `status=${blockedResult.output.status}`,
      `next=${blockedResult.output.next_action}`,
      `green=0`,
      `red=0`,
    ],
    timestamp: new Date().toISOString(),
  });
  st.results.push({ supervisorId: supId, stack: stackId, result: blockedResult });
}

function auditGateInvocations(
  ctx: OrchestratorContextT,
  audit: AuditWriter,
  supId: string,
  gates: readonly GateInvocation[],
): void {
  for (const gate of gates) {
    audit.write({
      run_id: ctx.run_id,
      step: "gate_invocation",
      agent: `${supId}-supervisor`,
      cmd: [...gate.cmd],
      cwd: gate.cwd,
      exit: gate.exit,
      decisions: [
        `kind=${gate.kind}`,
        `oom=${gate.oom}`,
        `timed_out=${gate.timed_out}`,
        `duration_ms=${gate.duration_ms}`,
      ],
      timestamp: new Date().toISOString(),
    });
  }
}

function buildBranchSupervisorInput(
  ctx: OrchestratorContextT,
  tasks: PlannerTaskT[],
  profile: StackProfile,
  overlay: string | undefined,
  cwd: string,
  supId: string,
  runDir: string | undefined,
  visited: readonly string[],
): RunSupervisorInput {
  return {
    tasks,
    ctx: { ...ctx, visited_nodes: [...visited] },
    profile,
    ...(overlay !== undefined ? { stackOverlay: overlay } : {}),
    cwd,
    supervisorId: supId,
    ...(runDir !== undefined ? { runDir } : {}),
  };
}

async function runSupervisorGroupNormal(
  ctx: OrchestratorContextT,
  supId: string,
  stackId: string,
  tasks: PlannerTaskT[],
  profile: ReturnType<typeof getStackProfile>,
  overlay: string | undefined,
  cwd: string,
  runDir: string | undefined,
  deps: SupervisorBranchDeps,
  st: BranchLoopState,
  audit: AuditWriter,
): Promise<void> {
  audit.write({
    run_id: ctx.run_id,
    step: "supervisor_spawn",
    agent: `${supId}-supervisor`,
    decisions: [
      `tasks=${tasks.map((t) => t.id).join(",")}`,
      `stack=${stackId}`,
      `cwd=${cwd}`,
    ],
    timestamp: new Date().toISOString(),
  });

  const supInput = buildBranchSupervisorInput(
    ctx,
    tasks,
    profile,
    overlay,
    cwd,
    supId,
    runDir,
    st.visited,
  );

  const result = await runSupervisor(supInput, {
    subagentCompletion: deps.subagentCompletion,
    fixSubagentCompletion: deps.fixSubagentCompletion,
    ...(deps.exec ? { exec: deps.exec } : {}),
    ...(deps.estimateTokens ? { estimateTokens: deps.estimateTokens } : {}),
  });

  st.visited = [...result.visited_nodes];

  auditGateInvocations(ctx, audit, supId, result.gate_history);

  const gatePublished = { current: st.gateContractPublished };
  recordContractProducers(
    result.output.task_results,
    tasks,
    supId,
    st.contractProducers,
    gatePublished,
  );
  st.gateContractPublished = gatePublished.current;

  audit.write({
    run_id: ctx.run_id,
    step: "supervisor_done",
    agent: `${supId}-supervisor`,
    decisions: [
      `status=${result.output.status}`,
      `next=${result.output.next_action}`,
      `green=${result.output.task_results.filter((r) => r.state === "green").length}`,
      `red=${result.output.task_results.filter((r) => r.state === "red").length}`,
      ...(result.output.pending_diff_path
        ? [`pending_diff=${result.output.pending_diff_path}`]
        : []),
      ...(st.gateContractPublished ? [`gate_contract_published=true`] : []),
    ],
    timestamp: new Date().toISOString(),
  });

  st.results.push({ supervisorId: supId, stack: stackId, result });
}

async function runOneSupervisorGroup(
  group: { supId: string; tasks: PlannerTaskT[] },
  input: SupervisorBranchInput,
  deps: SupervisorBranchDeps,
  audit: AuditWriter,
  runDir: string | undefined,
  st: BranchLoopState,
): Promise<void> {
  const { ctx } = input;
  const { supId, tasks } = group;
  const stackId = stackForSupervisor(supId);
  const cwd = input.cwds[supId];
  if (!cwd) throw new UnknownSupervisorCwd(supId);
  const profile = getStackProfile(stackId);
  const overlay = input.stackOverlays?.[stackId];

  const consumerTasks = tasks.filter((t) => t.consumes_contract);
  if (consumerTasks.length > 0 && !st.gateContractPublished) {
    await runSupervisorGroupBlocked(ctx, supId, stackId, tasks, consumerTasks, st, audit);
    return;
  }

  await runSupervisorGroupNormal(
    ctx,
    supId,
    stackId,
    tasks,
    profile,
    overlay,
    cwd,
    runDir,
    deps,
    st,
    audit,
  );
}

export async function runSupervisorBranch(
  input: SupervisorBranchInput,
  deps: SupervisorBranchDeps,
): Promise<SupervisorBranchResult> {
  const { ctx, plan } = input;
  /** When omitted, supervisor does not write `pending.diff` (executeLane may omit for branch coverage). */
  const runDir = input.runDir;
  const audit =
    input.auditWriter ??
    new AuditWriter({ path: ctx.audit_path, prevHash: ctx.prev_hash });

  const groups = groupBySupervisor(plan);
  const st: BranchLoopState = {
    visited: [...ctx.visited_nodes],
    gateContractPublished: ctx.gate_contract_published,
    contractProducers: [],
    results: [],
  };

  for (const g of groups) {
    await runOneSupervisorGroup(g, input, deps, audit, runDir, st);
  }

  const aggregate = aggregateStatusFromResults(st.results);

  return {
    supervisors: st.results,
    aggregateStatus: aggregate,
    gate_contract_published: st.gateContractPublished,
    contract_producers: st.contractProducers,
  };
}
