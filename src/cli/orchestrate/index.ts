import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertVaultShaAllowed,
  loadExpectations,
  type ExpectationsSnapshot,
} from "../../config/expectations.js";
import { loadBootConfig } from "../../config/env.js";
import { parseArgs, type ParsedArgs } from "../args.js";
import { assertDangerApplyPolicy } from "../../policy/hitl.js";
import type { BootSummary } from "./types.js";
import { inngest } from "../../inngest/client.js";
import { followInngestRun } from "./follow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function summarizeOutcome(gatesVerify: boolean, isExecute: boolean): BootSummary["outcome"] {
  if (gatesVerify) return "gates_verify";
  if (isExecute) return "execution_started";
  return "dry_plan";
}

type SendLane = "dry-plan" | "execute" | "gates-verify";

function inngestEventNameForLane(
  lane: SendLane,
): "orch/dry-plan.requested" | "orch/run.requested" | "orch/gates.verify.requested" {
  if (lane === "execute") return "orch/run.requested";
  if (lane === "gates-verify") return "orch/gates.verify.requested";
  return "orch/dry-plan.requested";
}

function artifactLinkFields(cfg: ReturnType<typeof loadBootConfig>, runId: string) {
  const base = (cfg.ORCH_ARTIFACT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3030"}`).replace(
    /\/+$/,
    "",
  );
  return {
    artifact_base_url: base,
    audit_url: `${base}/runs/${runId}/audit`,
    runs_dir_relative: `./runs/${runId}`,
  };
}

function bootSummaryShell(input: {
  runId: string;
  snapshot: ExpectationsSnapshot;
  isDryPlan: boolean;
  isExecute: boolean;
  gatesVerify: boolean;
  args: ParsedArgs;
  cfg: ReturnType<typeof loadBootConfig>;
  inngest_run_url?: string;
  event_id?: string;
}): BootSummary {
  const { runId, snapshot, isDryPlan, isExecute, gatesVerify, args, cfg, inngest_run_url, event_id } =
    input;
  return {
    ok: true,
    run_id: runId,
    outcome: summarizeOutcome(gatesVerify, isExecute),
    expectations_snapshot: {
      doc_sha256: snapshot.docSha256 || null,
      vault_git_sha: snapshot.vault_git_sha ?? null,
    },
    cli_flags: {
      dry_plan: isDryPlan,
      execute: isExecute,
      ...(gatesVerify ? { gates_verify: true } : {}),
      spec: args.spec,
      ...(args.dangerApply ? { danger_apply: true } : {}),
      ...(args.follow ? { follow: true } : {}),
    },
    tf_probe: { skipped: true },
    ...artifactLinkFields(cfg, runId),
    ...(inngest_run_url ? { inngest_run_url } : {}),
    ...(event_id ? { event_id } : {}),
  };
}

function specSlugFromPath(specPath: string): string {
  const base = path.basename(specPath);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function inngestUiBase(cfgBase: string | undefined): string {
  if (cfgBase) return cfgBase.replace(/\/+$/, "");
  return "http://127.0.0.1:8288";
}

async function sendOrchestrateEvent(input: {
  runId: string;
  specPath: string;
  lane: SendLane;
  reason?: string;
  dangerApply?: boolean;
}): Promise<{ eventId?: string }> {
  const slug = specSlugFromPath(input.specPath);
  const base = {
    runId: input.runId,
    specSlug: slug,
    repo: "agent-orchestrator" as const,
    specPath: input.specPath,
  };
  const name = inngestEventNameForLane(input.lane);
  const data =
    input.lane === "gates-verify"
      ? base
      : {
          ...base,
          ...(input.lane === "execute" && input.reason ? { reason: input.reason } : {}),
          ...(input.lane === "execute" && input.dangerApply ? { dangerApply: true } : {}),
        };
  const sent = await inngest.send({ name, data });
  const ids = (sent as { ids?: string[] }).ids;
  return { eventId: ids?.[0] };
}

function bootOnlySummary(
  snapshot: ExpectationsSnapshot,
  args: ParsedArgs,
  isDryPlan: boolean,
  isExecute: boolean,
): BootSummary {
  return {
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
      ...(args.gatesVerify ? { gates_verify: true } : {}),
      ...(args.dangerApply ? { danger_apply: true } : {}),
      ...(args.follow ? { follow: true } : {}),
    },
    tf_probe: { skipped: true },
  };
}

async function runOrchestrateWithSpec(input: {
  args: ParsedArgs;
  cfg: ReturnType<typeof loadBootConfig>;
  snapshot: ExpectationsSnapshot;
  gatesVerify: boolean;
  isExecute: boolean;
  isDryPlan: boolean;
}): Promise<void> {
  const { args, cfg, snapshot, gatesVerify, isExecute, isDryPlan } = input;
  const runId = randomUUID();
  let lane: SendLane = "dry-plan";
  if (gatesVerify) lane = "gates-verify";
  else if (isExecute) lane = "execute";
  const { eventId } = await sendOrchestrateEvent({
    runId,
    specPath: args.spec ?? "",
    lane,
    ...(lane === "execute" ? { reason: args.reason, dangerApply: args.dangerApply } : {}),
  });
  const uiBase = inngestUiBase(cfg.INNGEST_BASE_URL);
  const inngestRunUrl = `${uiBase}/runs/${runId}`;
  console.log(
    JSON.stringify(
      bootSummaryShell({
        runId,
        snapshot,
        isDryPlan,
        isExecute,
        gatesVerify,
        args,
        cfg,
        inngest_run_url: inngestRunUrl,
        ...(eventId ? { event_id: eventId } : {}),
      }),
      null,
      2,
    ),
  );
  if (!args.follow) return;
  const exitCode = await followInngestRun({
    runId,
    baseUrl: uiBase,
  });
  if (exitCode !== 0) process.exit(exitCode);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gatesVerify = args.gatesVerify === true;
  const isExecute = args.execute === true && !gatesVerify;
  assertDangerApplyPolicy({
    execute: isExecute,
    dryPlan: args.dryPlan && !gatesVerify,
    dangerApply: args.dangerApply,
    reason: args.reason,
  });
  const isDryPlan = !isExecute && !gatesVerify;

  const cfg = loadBootConfig();
  const { snapshot, warnings } = await loadExpectations(repoRoot);
  for (const w of warnings) console.warn(`[expectations] ${w}`);
  assertVaultShaAllowed(snapshot, cfg.EXPECTED_VAULT_SHA, cfg.strictExpectations);

  if (!args.spec) {
    console.warn(
      "[orchestrate] boot_only: no --spec → no Inngest send. " +
        "Example: pnpm run orchestrate -- --spec fixtures/no-op.md (add inngest:serve + inngest:dev for UI).",
    );
    console.log(JSON.stringify(bootOnlySummary(snapshot, args, isDryPlan, isExecute), null, 2));
    return;
  }

  await runOrchestrateWithSpec({
    args,
    cfg,
    snapshot,
    gatesVerify,
    isExecute,
    isDryPlan,
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
