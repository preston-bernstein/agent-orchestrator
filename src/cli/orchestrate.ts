import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { assertVaultShaAllowed, loadExpectations } from "../config/expectations.js";
import { loadBootConfig, requireTfConfig } from "../config/env.js";
import { TfClient, type TfProbeResult } from "../tf/client.js";
import { initRunContext } from "../runs/orchestratorContext.js";
import { loadSpec } from "../runs/loadSpec.js";
import { atomicWriteJson } from "../runs/state.js";
import { runPlannerBranch } from "../workflows/plannerBranch.js";
import { runExecuteLane, type Phase7Outcome } from "../workflows/executeLane.js";
import { loadManagedRepos } from "../config/managedRepos.js";
import { mockSubagentCompletion } from "../agents/subagent.js";
import { mockFixSubagentCompletion } from "../agents/fixSubagent.js";
import { mockExec } from "../gates/runQuality.js";
import { parseArgs } from "./args.js";
import { assertDangerApplyPolicy } from "../policy/hitl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

interface BootSummary {
  ok: boolean;
  run_id: string;
  outcome:
    | "skipped"
    | "dry_plan"
    | "execution_started"
    | "execute_completed"
    | "paused_for_approval"
    | "reviewer_failed"
    | "boot_only";
  expectations_snapshot: {
    doc_sha256: string | null;
    vault_git_sha: string | null;
  };
  cli_flags: { dry_plan: boolean; execute: boolean; spec?: string; danger_apply?: boolean };
  tf_probe: { skipped: true } | { skipped: false; status: number; models: number };
  plan_path?: string;
  reason?: string;
  execute?: {
    aggregateStatus: string;
    supervisors: { id: string; status: string }[];
    integration:
      | { ran: false; reason: string }
      | { ran: true; status: string; recommended: string };
    phase7?: {
      kind: string;
      approval_prompt_paths?: string[];
      reviewer_findings?: number;
      skipped_reason?: string;
    };
  };
}

async function main(): Promise<void> {
  let exitCode = 0;
  const args = parseArgs(process.argv.slice(2));
  assertDangerApplyPolicy({
    execute: args.execute,
    dryPlan: args.dryPlan,
    dangerApply: args.dangerApply,
    reason: args.reason,
  });
  const isExecute = args.execute === true;
  const isDryPlan = !isExecute;

  const cfg = loadBootConfig();
  const { snapshot, warnings } = await loadExpectations(repoRoot);
  for (const w of warnings) console.warn(`[expectations] ${w}`);
  assertVaultShaAllowed(snapshot, cfg.EXPECTED_VAULT_SHA, cfg.strictExpectations);

  const mockMode = process.env.MOCK_TF === "1";
  let probe: TfProbeResult | null = null;
  let tfCaps:
    | { structured_output: boolean; tool_use: boolean }
    | undefined;
  if (!mockMode) {
    const tf = requireTfConfig(cfg);
    if (!cfg.skipTfProbe) {
      const client = new TfClient(tf);
      probe = await client.probe();
      tfCaps = { structured_output: probe.models.length > 0, tool_use: false };
    }
  }

  if (!args.spec) {
    const summary: BootSummary = {
      ok: true,
      run_id: "",
      outcome: "boot_only",
      expectations_snapshot: {
        doc_sha256: snapshot.docSha256 || null,
        vault_git_sha: snapshot.vault_git_sha ?? null,
      },
      cli_flags: {
        dry_plan: isDryPlan,
        execute: isExecute,
        ...(args.dangerApply ? { danger_apply: true } : {}),
      },
      tf_probe: probe
        ? { skipped: false, status: probe.status, models: probe.models.length }
        : { skipped: true },
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const runId = randomUUID();
  const runsDir = path.resolve(cfg.RUNS_DIR);
  const runDir = path.join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  const audit_path = path.join(runDir, "audit.jsonl");
  const state_file_path = path.join(runDir, "state.json");

  const spec = await loadSpec(args.spec);

  const cliFlags = {
    dry_plan: isDryPlan,
    execute: isExecute,
    spec_path: args.spec,
    ...(args.dangerApply ? { danger_apply: true as const } : {}),
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
  };
  const ctx = initRunContext({
    run_id: runId,
    started_at: new Date().toISOString(),
    cli_flags: cliFlags,
    expectations_snapshot: snapshot,
    audit_path,
    state_file_path,
    specs: [spec],
    tf_capabilities: tfCaps,
  });
  atomicWriteJson({ path: state_file_path, data: ctx });

  const outcome = await runPlannerBranch({ ctx, cliFlags, runDir });
  ctx.prev_hash = outcome.auditTailHash;
  atomicWriteJson({ path: state_file_path, data: ctx });

  let executeResult:
    | Awaited<ReturnType<typeof runExecuteLane>>
    | undefined;
  if (outcome.kind === "execution_started") {
    if (!cfg.ORCH_MANAGED_REPOS) {
      throw new Error(
        "execute lane refused: ORCH_MANAGED_REPOS unset (set in .env per .env.example; or run --dry-plan)",
      );
    }
    const repos = await loadManagedRepos({ envRaw: cfg.ORCH_MANAGED_REPOS });

    if (!mockMode) {
      throw new Error(
        "execute lane: real-TF subagent completion not wired (Phase 5+); set MOCK_TF=1 for offline smoke",
      );
    }
    executeResult = await runExecuteLane(
      { ctx, plan: outcome.plan, repos, runDir },
      {
        subagentCompletion: mockSubagentCompletion(
          [
            "diff --git a/mock/no-op/readme.md b/mock/no-op/readme.md\n",
            "+++ b/mock/no-op/readme.md\n",
            "@@ -0,0 +1 @@\n",
            "+orch fixture tweak\n",
          ].join(""),
          ["mock/no-op/readme.md"],
        ),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "MOCK GATE OK" }),
      },
    );
  }

  const summary: BootSummary = {
    ok: true,
    run_id: runId,
    outcome: executeResult ? "execute_completed" : outcome.kind,
    expectations_snapshot: {
      doc_sha256: snapshot.docSha256 || null,
      vault_git_sha: snapshot.vault_git_sha ?? null,
    },
    cli_flags: {
      dry_plan: isDryPlan,
      execute: isExecute,
      spec: args.spec,
      ...(args.dangerApply ? { danger_apply: true } : {}),
    },
    tf_probe: probe
      ? { skipped: false, status: probe.status, models: probe.models.length }
      : { skipped: true },
    plan_path: outcome.kind === "skipped" ? undefined : outcome.planPath,
    reason: outcome.kind === "skipped" ? outcome.reason : undefined,
    ...(executeResult
      ? {
          execute: {
            aggregateStatus: executeResult.aggregateStatus,
            supervisors: executeResult.supervisors.map((s) => ({
              id: s.supervisorId,
              status: s.result.output.status,
            })),
            integration: executeResult.integration.ran
              ? {
                  ran: true as const,
                  status: executeResult.integration.output.status,
                  recommended:
                    executeResult.integration.output.recommended_action,
                }
              : {
                  ran: false as const,
                  reason: executeResult.integration.reason,
                },
            phase7: phase7SummarySlice(executeResult.phase7),
          },
        }
      : {}),
  };

  if (executeResult) {
    const p7 = executeResult.phase7;
    if (p7.kind === "paused_for_approval") {
      summary.outcome = "paused_for_approval";
      exitCode = 2;
    } else if (p7.kind === "reviewer_fail") {
      summary.ok = false;
      summary.outcome = "reviewer_failed";
      exitCode = 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (exitCode !== 0) process.exit(exitCode);
}

function phase7SummarySlice(p7: Phase7Outcome):
  | {
      kind: string;
      approval_prompt_paths?: string[];
      reviewer_findings?: number;
      skipped_reason?: string;
    }
  | undefined {
  switch (p7.kind) {
    case "skipped":
      return { kind: p7.kind, skipped_reason: p7.reason };
    case "reviewer_fail":
      return {
        kind: p7.kind,
        reviewer_findings: p7.reviewer.findings.length,
      };
    case "paused_for_approval":
      return {
        kind: p7.kind,
        approval_prompt_paths: [...p7.approval_prompt_paths],
      };
    case "cleared":
      return { kind: p7.kind };
    default: {
      const _e: never = p7;
      return _e;
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
