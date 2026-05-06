import { createHash } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BootConfig, TfConfig } from "../../config/env.js";
import { requireTfConfig } from "../../config/env.js";
import { TfClient } from "../../tf/client.js";
import type { SupervisorBranchResult } from "../../workflows/supervisorBranch.js";
import type { SpecSnapshotT } from "../../runs/RunContext.js";

export function orchestratorRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function specSlugFromMarkdownPath(absPath: string): string {
  const base = path.basename(absPath);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export function specSnapshotFromMarkdownPath(absPath: string): SpecSnapshotT {
  const raw = readFileSync(absPath, "utf8");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  return {
    slug: specSlugFromMarkdownPath(absPath),
    repo: "agent-orchestrator",
    stack: "ts-node",
    requirements_path: absPath,
    tasks_path: absPath,
    design_path: absPath,
    hash,
  };
}

export async function tfCapabilitiesProbe(cfg: BootConfig): Promise<{
  structured_output: boolean;
  tool_use: boolean;
}> {
  if (cfg.skipTfProbe || cfg.mockTf) {
    return { structured_output: true, tool_use: true };
  }
  const tf: TfConfig = requireTfConfig(cfg);
  const probe = await new TfClient(tf).probe();
  return {
    structured_output: probe.ok,
    tool_use: probe.models.length > 0,
  };
}

export function supervisorsAwaitingApproval(
  branch: Pick<SupervisorBranchResult, "supervisors">,
): string[] {
  const ids: string[] = [];
  for (const s of branch.supervisors) {
    if (
      s.result.output.pending_diff_path !== undefined &&
      s.result.output.status === "done"
    ) {
      ids.push(s.supervisorId);
    }
  }
  return ids;
}

export function approveWaitPlans(
  supervisors: readonly string[],
): { stepId: string; event: "orch/approve.spring" | "orch/approve.react" }[] {
  const out: ReturnType<typeof approveWaitPlans> = [];
  for (const sup of supervisors) {
    if (sup === "spring")
      out.push({ stepId: "approve-spring", event: "orch/approve.spring" });
    if (sup === "react")
      out.push({ stepId: "approve-react", event: "orch/approve.react" });
  }
  return out;
}

export function emptyGitStatus(): Promise<string> {
  return Promise.resolve("");
}
