import path from "node:path";
import { mkdirSync } from "node:fs";
import { AuditWriter } from "../audit/jsonl.js";
import {
  mockPlannerCompletion,
  runPlanner,
} from "../agents/planner/index.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import {
  plannerDryRun,
  type PlannerDryRunInput,
} from "../planner/dryRun.js";
import type { AssembledPrompt } from "../llm/assemblePrompt.js";
import type { OrchestratorContextT } from "../runs/orchestratorContext.js";
import { loadBootConfig } from "../config/env.js";
import { atomicWriteJson } from "../runs/state.js";

/**
 * Phase 4 plan-only branch. Composes:
 *   caveman (inside `runPlanner`) → O5 dry-run → planner (TF or mock) →
 *   `runs/<run_id>/plan.json` artifact + audit `dry_plan` event → STOP.
 *
 * **A4 mutation gate:** dry-plan path NEVER spawns supervisors / managed-repo
 * subprocesses — vault canon `Build/Patterns/O5-planner-dry-run.md` §A4 +
 * `Build/Playbook.md` Phase 4. `--execute` audits `execution_started` and
 * delegates to `supervisorSpawnGuard` which currently throws (Phase 5 wires
 * supervisors).
 */

interface CliFlags {
  dry_plan?: boolean;
  execute?: boolean;
  spec_path?: string;
}

interface PlannerBranchInput {
  ctx: OrchestratorContextT;
  cliFlags: CliFlags;
  /** completion function — `mockPlannerCompletion(specs)` for MOCK_TF; real TF later. */
  completion?: (prompt: AssembledPrompt) => Promise<unknown>;
  /** override default `runs/<run_id>/` directory (tests). */
  runDir?: string;
  /** override default audit writer (tests can pre-construct). */
  auditWriter?: AuditWriter;
  /**
   * Inject `plannerDryRun` deps (gitStatus, readTasks). Tests pass clean
   * fakes so the dry-plan path runs **with zero `child_process` calls** —
   * proves task 29 contract (managed-repo subprocess gate) by construction.
   */
  dryRunDeps?: Pick<PlannerDryRunInput, "gitStatus" | "readTasks">;
}

export type PlannerBranchOutcome =
  | { kind: "skipped"; reason: string; auditTailHash: string }
  | { kind: "dry_plan"; planPath: string; plan: PlannerOutputT; auditTailHash: string }
  | {
      kind: "execution_started";
      planPath: string;
      plan: PlannerOutputT;
      auditTailHash: string;
    };

export class CliFlagConflict extends Error {
  constructor() {
    super("--dry-plan and --execute are mutually exclusive");
    this.name = "CliFlagConflict";
  }
}

export class SupervisorNotWiredError extends Error {
  constructor() {
    super(
      "supervisor spawn refused: Phase 5 not yet wired (Playbook.md Phase 5; tasks 25–46)",
    );
    this.name = "SupervisorNotWiredError";
  }
}

/**
 * Abuse-test surface (task 34, vault `Build/Playbook Fidelity Plan.md` §A4).
 * Any future code that wants to spawn a supervisor MUST call this guard.
 * Throws when `cli_flags.execute` is not strictly true — defends against
 * accidental supervisor spawn from a dry-plan workflow path.
 */
export function supervisorSpawnGuard(
  cliFlags: Readonly<Record<string, unknown>>,
): void {
  if (cliFlags.execute !== true) {
    throw new SupervisorNotWiredError();
  }
}

function resolveCompletion(
  input: PlannerBranchInput,
): (prompt: AssembledPrompt) => Promise<unknown> {
  if (input.completion) return input.completion;
  if (loadBootConfig().mockTf) {
    return mockPlannerCompletion(input.ctx.specs) as (
      p: AssembledPrompt,
    ) => Promise<unknown>;
  }
  return async () => {
    throw new Error(
      "real-TF planner completion not wired (Phase 5 work); set MOCK_TF=1 for offline run",
    );
  };
}

function outcomeFromDryRunSkip(
  ctx: OrchestratorContextT,
  audit: AuditWriter,
  reason: string,
): PlannerBranchOutcome {
  audit.write({
    run_id: ctx.run_id,
    step: "planner_skipped",
    agent: "planner",
    decisions: [reason],
    timestamp: new Date().toISOString(),
  });
  return {
    kind: "skipped",
    reason,
    auditTailHash: audit.currentPrevHash,
  };
}

function finalizePlannerBranchOutcome(
  ctx: OrchestratorContextT,
  audit: AuditWriter,
  planPath: string,
  plan: PlannerOutputT,
  isExecute: boolean,
): PlannerBranchOutcome {
  if (!isExecute) {
    audit.write({
      run_id: ctx.run_id,
      step: "dry_plan",
      agent: "system",
      decisions: ["A4 mutation gate held: no supervisor spawn"],
      timestamp: new Date().toISOString(),
    });
    return {
      kind: "dry_plan",
      planPath,
      plan,
      auditTailHash: audit.currentPrevHash,
    };
  }

  audit.write({
    run_id: ctx.run_id,
    step: "execution_started",
    agent: "system",
    decisions: ["execute=true; handing off to supervisors"],
    timestamp: new Date().toISOString(),
  });
  return {
    kind: "execution_started",
    planPath,
    plan,
    auditTailHash: audit.currentPrevHash,
  };
}

function resolvePlannerRunDir(input: PlannerBranchInput): string {
  const runDir = input.runDir ?? path.dirname(input.ctx.state_file_path);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function auditPlannerBranchStart(
  ctx: OrchestratorContextT,
  audit: AuditWriter,
  isExecute: boolean,
): void {
  audit.write({
    run_id: ctx.run_id,
    step: "planner_branch:start",
    agent: "system",
    decisions: [
      isExecute ? "execute=true" : "dry_plan=default-or-explicit",
      `specs=${ctx.specs.length}`,
    ],
    timestamp: new Date().toISOString(),
  });
}

export async function runPlannerBranch(
  input: PlannerBranchInput,
): Promise<PlannerBranchOutcome> {
  const { ctx, cliFlags } = input;

  if (cliFlags.dry_plan && cliFlags.execute) {
    throw new CliFlagConflict();
  }
  const isExecute = cliFlags.execute === true;

  const runDir = resolvePlannerRunDir(input);

  const audit =
    input.auditWriter ??
    new AuditWriter({ path: ctx.audit_path, prevHash: ctx.prev_hash });

  auditPlannerBranchStart(ctx, audit, isExecute);

  const dryRun = await plannerDryRun({
    specs: ctx.specs.map((s) => ({
      slug: s.slug,
      tasks_path: s.tasks_path,
      repo: process.cwd(),
    })),
    attempt_counter: ctx.attempt_counter,
    ...(input.dryRunDeps ?? {}),
  });
  if (dryRun.skip) {
    return outcomeFromDryRunSkip(ctx, audit, dryRun.reason);
  }

  const completion = resolveCompletion(input);
  const plan = (await runPlanner(
    {
      specs: ctx.specs,
      cli_flags: ctx.cli_flags,
      tf_capabilities: ctx.tf_capabilities,
      onCavemanCompress: (phase) => {
        audit.write({
          run_id: ctx.run_id,
          step: "caveman_compress",
          agent: "planner",
          decisions: [phase === "planner-header" ? "header" : phase],
          timestamp: new Date().toISOString(),
        });
      },
    },
    { completion },
  )) as PlannerOutputT;

  const planPath = path.join(runDir, "plan.json");
  atomicWriteJson({ path: planPath, data: plan });
  audit.write({
    run_id: ctx.run_id,
    step: "planner_emitted",
    agent: "planner",
    decisions: [
      `status=${plan.status}`,
      `tasks=${plan.tasks.length}`,
      `path=${planPath}`,
    ],
    timestamp: new Date().toISOString(),
  });

  return finalizePlannerBranchOutcome(ctx, audit, planPath, plan, isExecute);
}
