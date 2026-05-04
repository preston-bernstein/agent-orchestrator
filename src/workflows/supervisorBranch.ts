import path from "node:path";
import { AuditWriter } from "../audit/jsonl.js";
import type { AssembledPrompt } from "../llm/assemblePrompt.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import type { PlannerOutputT, PlannerTaskT } from "../agents/planner.schema.js";
import {
  runSupervisor,
  type RunSupervisorResult,
} from "../agents/supervisor.js";
import { getStackProfile } from "../stacks/index.js";
import type { RunQualityDeps } from "../gates/runQuality.js";

/**
 * Phase 5 supervisor dispatch. Reads `PlannerOutput`, groups tasks by
 * supervisor (`spring` | `react` | `orch`), runs each supervisor in
 * sequence (Phase 6 lifts to parallel + integration agent).
 *
 * Vault canon: `Build/Playbook.md` §Phase 5; `Build/Prompts/supervisor-base.md`.
 *
 * Audit events emitted:
 *   - `supervisor_spawn` — once per supervisor; `decisions` lists task ids.
 *   - `gate_invocation` — one per `runQuality` call (cmd + exit + tail digest).
 *   - `supervisor_done` — final status + `pending_diff_path` when present.
 *
 * Phase 5 known gaps:
 *   - No real `git apply` to managed working tree (in-memory patch journal
 *     only). `pending_diff_path` is the merged-string artifact; Phase 7
 *     Approval reads it.
 *   - No cross-supervisor parallelism / integration handshake (Phase 6).
 *   - No Inngest durability (tasks 35–46, HITL-gated).
 */

export interface SupervisorBranchInput {
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

export interface SupervisorBranchDeps {
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
  aggregateStatus: "green" | "red" | "needs_human_clarify" | "budget_exhausted";
}

export class UnknownSupervisorCwd extends Error {
  constructor(public readonly supervisorId: string) {
    super(
      `no cwd registered for supervisor '${supervisorId}' — pass cwds[${supervisorId}] in SupervisorBranchInput`,
    );
    this.name = "UnknownSupervisorCwd";
  }
}

function groupBySupervisor(
  plan: PlannerOutputT,
): Map<string, PlannerTaskT[]> {
  const out = new Map<string, PlannerTaskT[]>();
  for (const t of plan.tasks) {
    const list = out.get(t.supervisor) ?? [];
    list.push(t);
    out.set(t.supervisor, list);
  }
  return out;
}

/**
 * Resolve stack id for a supervisor. Phase 5 hard-coding:
 *   spring → java-spring, react → ts-react-vite, orch → ts-node.
 * Phase 6 will read this from `_meta.md` per managed repo.
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

export async function runSupervisorBranch(
  input: SupervisorBranchInput,
  deps: SupervisorBranchDeps,
): Promise<SupervisorBranchResult> {
  const { ctx, plan } = input;
  const runDir = input.runDir ?? path.dirname(ctx.state_file_path);
  const audit =
    input.auditWriter ??
    new AuditWriter({ path: ctx.audit_path, prevHash: ctx.prev_hash });

  const groups = groupBySupervisor(plan);
  const results: {
    supervisorId: string;
    stack: string;
    result: RunSupervisorResult;
  }[] = [];
  let visited = [...ctx.visited_nodes];

  for (const [supId, tasks] of groups) {
    const stackId = stackForSupervisor(supId);
    const cwd = input.cwds[supId];
    if (!cwd) throw new UnknownSupervisorCwd(supId);
    const profile = getStackProfile(stackId);
    const overlay = input.stackOverlays?.[stackId];

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

    const result = await runSupervisor(
      {
        tasks,
        ctx: { ...ctx, visited_nodes: visited },
        profile,
        ...(overlay !== undefined ? { stackOverlay: overlay } : {}),
        cwd,
        supervisorId: supId,
        runDir,
      },
      {
        subagentCompletion: deps.subagentCompletion,
        fixSubagentCompletion: deps.fixSubagentCompletion,
        ...(deps.exec ? { exec: deps.exec } : {}),
        ...(deps.estimateTokens ? { estimateTokens: deps.estimateTokens } : {}),
      },
    );

    visited = [...result.visited_nodes];

    for (const gate of result.gate_history) {
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
      ],
      timestamp: new Date().toISOString(),
    });

    results.push({ supervisorId: supId, stack: stackId, result });
  }

  let aggregate: SupervisorBranchResult["aggregateStatus"] = "green";
  for (const r of results) {
    const s = r.result.output.status;
    if (s === "needs_human_clarify") {
      aggregate = "needs_human_clarify";
      break;
    }
    if (s === "budget_exhausted") {
      aggregate = "budget_exhausted";
      break;
    }
    if (s !== "done") aggregate = "red";
  }

  return { supervisors: results, aggregateStatus: aggregate };
}
