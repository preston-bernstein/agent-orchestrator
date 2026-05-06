import { atomicWriteJson } from "../../runs/state.js";
import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";

export function persistOrchestratorCtx(
  ctx: OrchestratorContextT,
  tailHash: string,
): OrchestratorContextT {
  const next = { ...ctx, prev_hash: tailHash };
  atomicWriteJson({ path: next.state_file_path, data: next });
  return next;
}
