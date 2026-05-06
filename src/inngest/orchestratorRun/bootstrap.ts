import path from "node:path";
import { mkdirSync } from "node:fs";
import { AuditWriter } from "../../audit/jsonl.js";
import {
  loadExpectations,
  assertVaultShaAllowed,
  type ExpectationsSnapshot,
} from "../../config/expectations.js";
import { loadBootConfig } from "../../config/env.js";
import { initRunContext, type OrchestratorContextT } from "../../runs/orchestratorContext.js";
import { atomicWriteJson } from "../../runs/state.js";
import { persistOrchestratorCtx } from "./persistCtx.js";
import {
  runPlannerBranch,
  type PlannerBranchOutcome,
} from "../../workflows/plannerBranch.js";
import type { OrchStep, OrchRunEvent, OrchRunOverrides } from "./types.js";
import {
  orchestratorRepoRoot,
  tfCapabilitiesProbe,
  specSnapshotFromMarkdownPath,
} from "./helpers.js";

function expectationsBootRunnable(event: OrchRunEvent, repoRoot: string) {
  return async (): Promise<{ ctx: OrchestratorContextT }> => {
    const cfg = loadBootConfig();
    const { snapshot } = await loadExpectations(repoRoot);
    assertVaultShaAllowed(snapshot, cfg.EXPECTED_VAULT_SHA, cfg.strictExpectations);
    const runsDir = path.resolve(repoRoot, cfg.RUNS_DIR);
    const runDir = path.join(runsDir, event.data.runId);
    mkdirSync(runDir, { recursive: true });
    const absSpec = path.isAbsolute(event.data.specPath)
      ? event.data.specPath
      : path.resolve(process.cwd(), event.data.specPath);
    const spec = specSnapshotFromMarkdownPath(absSpec);
    const hitlExtras =
      event.name === "orch/gates.verify.requested"
        ? {}
        : {
            ...("reason" in event.data && event.data.reason
              ? { reason: event.data.reason }
              : {}),
            ...("dangerApply" in event.data && event.data.dangerApply === true
              ? { danger_apply: true }
              : {}),
          };

    let cli_flags: Record<string, unknown>;
    if (event.name === "orch/gates.verify.requested") {
      cli_flags = { gates_verify: true, dry_plan: false, execute: false, spec_path: absSpec };
    } else if (event.name === "orch/dry-plan.requested") {
      cli_flags = { dry_plan: true, execute: false, spec_path: absSpec, ...hitlExtras };
    } else {
      cli_flags = { execute: true, dry_plan: false, spec_path: absSpec, ...hitlExtras };
    }
    const snap: ExpectationsSnapshot = snapshot;
    const ctxSeed = initRunContext({
      run_id: event.data.runId,
      started_at: new Date().toISOString(),
      cli_flags,
      expectations_snapshot: snap,
      audit_path: path.join(runDir, "audit.jsonl"),
      state_file_path: path.join(runDir, "state.json"),
      specs: [spec],
    });
    atomicWriteJson({ path: ctxSeed.state_file_path, data: ctxSeed });
    const w = new AuditWriter({ path: ctxSeed.audit_path, prevHash: ctxSeed.prev_hash });
    w.write({
      run_id: ctxSeed.run_id,
      step: "expectations_loaded",
      agent: "system",
      decisions: [`doc_sha256=${snap.docSha256.slice(0, 12)}`],
      timestamp: new Date().toISOString(),
    });
    return { ctx: persistOrchestratorCtx(ctxSeed, w.currentPrevHash) };
  };
}

function tfProbeRunnable(prev: OrchestratorContextT) {
  return async (): Promise<{ ctx: OrchestratorContextT }> => {
    const caps = await tfCapabilitiesProbe(loadBootConfig());
    const w = new AuditWriter({ path: prev.audit_path, prevHash: prev.prev_hash });
    w.write({
      run_id: prev.run_id,
      step: "tf_capabilities_probe",
      agent: "system",
      decisions: [`structured=${caps.structured_output}`, `tool_use=${caps.tool_use}`],
      timestamp: new Date().toISOString(),
    });
    const next = { ...prev, tf_capabilities: caps, prev_hash: w.currentPrevHash };
    atomicWriteJson({ path: next.state_file_path, data: next });
    return { ctx: next };
  };
}

function plannerRunnable(
  prev: OrchestratorContextT,
  overrides: OrchRunOverrides | undefined,
) {
  return async (): Promise<{
    ctx: OrchestratorContextT;
    outcome: PlannerBranchOutcome;
  }> => {
    const plannerFn = overrides?.runPlannerBranch ?? runPlannerBranch;
    const audit = new AuditWriter({ path: prev.audit_path, prevHash: prev.prev_hash });
    const outcome = await plannerFn({
      ctx: prev,
      cliFlags: prev.cli_flags,
      auditWriter: audit,
    });
    return {
      ctx: persistOrchestratorCtx(prev, audit.currentPrevHash),
      outcome,
    };
  };
}

/** Expectations + TF probe only — gates-verify and future paths reuse before planner. */
export async function runOrchPrePlannerSteps(input: {
  event: OrchRunEvent;
  step: OrchStep;
  repoRoot?: string;
}): Promise<OrchestratorContextT> {
  const { event, step } = input;
  const repoRoot = input.repoRoot ?? orchestratorRepoRoot();
  const boot = await step.run("expectations-boot", expectationsBootRunnable(event, repoRoot));
  const probed = await step.run("tf-probe", tfProbeRunnable(boot.ctx));
  return probed.ctx;
}

export async function runOrchBootstrapSteps(input: {
  event: OrchRunEvent;
  step: OrchStep;
  overrides?: OrchRunOverrides;
  repoRoot?: string;
}): Promise<{ ctx: OrchestratorContextT; outcome: PlannerBranchOutcome }> {
  const { step, overrides } = input;
  const ctx = await runOrchPrePlannerSteps(input);
  return await step.run("planner-branch", plannerRunnable(ctx, overrides));
}
