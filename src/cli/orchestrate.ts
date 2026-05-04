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
import { parseArgs } from "./args.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

interface BootSummary {
  ok: boolean;
  run_id: string;
  outcome:
    | "skipped"
    | "dry_plan"
    | "execution_started"
    | "boot_only";
  expectations_snapshot: {
    doc_sha256: string | null;
    vault_git_sha: string | null;
  };
  cli_flags: { dry_plan: boolean; execute: boolean; spec?: string };
  tf_probe: { skipped: true } | { skipped: false; status: number; models: number };
  plan_path?: string;
  reason?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
      cli_flags: { dry_plan: isDryPlan, execute: isExecute },
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

  const summary: BootSummary = {
    ok: true,
    run_id: runId,
    outcome: outcome.kind,
    expectations_snapshot: {
      doc_sha256: snapshot.docSha256 || null,
      vault_git_sha: snapshot.vault_git_sha ?? null,
    },
    cli_flags: { dry_plan: isDryPlan, execute: isExecute, spec: args.spec },
    tf_probe: probe
      ? { skipped: false, status: probe.status, models: probe.models.length }
      : { skipped: true },
    plan_path: outcome.kind === "skipped" ? undefined : outcome.planPath,
    reason: outcome.kind === "skipped" ? outcome.reason : undefined,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
