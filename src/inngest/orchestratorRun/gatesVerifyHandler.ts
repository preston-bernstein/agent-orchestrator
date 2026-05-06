import { AuditWriter } from "../../audit/jsonl.js";
import { atomicWriteJson } from "../../runs/state.js";
import type { OrchestratorContextT } from "../../runs/orchestratorContext.js";
import {
  loadManagedRepos,
  type ManagedRepoMap,
  type SupervisorId,
} from "../../config/managedRepos.js";
import { runQuality } from "../../gates/runQuality.js";
import type { GateInvocation, GateKind } from "../../gates/types.js";
import { compareSupervisorIds } from "../../workflows/supervisorOrder.js";
import { auditTailPrevHash } from "./auditTailHash.js";
import type {
  OrchGateKind,
  OrchGatesVerifyEventData,
  OrchRunOverrides,
  OrchRunResult,
  OrchStep,
} from "./types.js";

function persistCtxTail(ctx: OrchestratorContextT, tailHash: string): void {
  atomicWriteJson({ path: ctx.state_file_path, data: { ...ctx, prev_hash: tailHash } });
}

function writeGateAudit(
  ctx: OrchestratorContextT,
  gate: GateInvocation,
  supervisorId: string,
): AuditWriter {
  const prevHash = auditTailPrevHash(ctx.audit_path, ctx.prev_hash);
  const w = new AuditWriter({ path: ctx.audit_path, prevHash });
  w.write({
    run_id: ctx.run_id,
    step: "gate_invocation",
    agent: `${supervisorId}-gates-verify`,
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
  return w;
}

const DEFAULT_GATE_KINDS: readonly OrchGateKind[] = ["preflight", "fast"];

export async function runOrchGatesVerifyHandler(input: {
  step: OrchStep;
  ctx: OrchestratorContextT;
  data: OrchGatesVerifyEventData;
  overrides?: OrchRunOverrides;
}): Promise<OrchRunResult> {
  const { step, data, overrides } = input;
  const runQ = overrides?.gatesVerifyQuality ?? runQuality;
  let ctxMutable: OrchestratorContextT = input.ctx;
  const kinds = (data.gateKinds ?? DEFAULT_GATE_KINDS) as readonly GateKind[];
  const repos: ManagedRepoMap = await step.run(
    "load-managed-repos",
    async () =>
      (overrides?.loadManagedRepos?.() ??
        loadManagedRepos({ envRaw: process.env.ORCH_MANAGED_REPOS ?? "" })),
  );
  const keys = Object.keys(repos).sort(compareSupervisorIds);
  if (keys.length === 0) {
    throw new Error(
      "orch/gates.verify: ORCH_MANAGED_REPOS empty — register spring-api/react-ui paths first",
    );
  }
  const failures: { supervisorId: string; kind: string; exit: number }[] = [];

  for (const supId of keys) {
    const entry = repos[supId as SupervisorId];
    if (!entry) continue;
    for (const kind of kinds) {
      const gate = await step.run(
        `gate-verify:${supId}:${kind}`,
        async (): Promise<GateInvocation> => {
          const inv = await runQ(
            {
              profile: entry.profile,
              cwd: entry.cwd,
              kind,
            },
            {},
          );
          const w = writeGateAudit(ctxMutable, inv, supId);
          ctxMutable = { ...ctxMutable, prev_hash: w.currentPrevHash };
          persistCtxTail(ctxMutable, w.currentPrevHash);
          return inv;
        },
      );
      if (gate.exit !== 0) failures.push({ supervisorId: supId, kind, exit: gate.exit });
    }
  }

  await step.run("audit-gates-verify-finalize", async () => {
    const prevHash = auditTailPrevHash(ctxMutable.audit_path, ctxMutable.prev_hash);
    const w = new AuditWriter({ path: ctxMutable.audit_path, prevHash });
    w.write({
      run_id: ctxMutable.run_id,
      step: "gates_verify_done",
      agent: "system",
      decisions: failures.length > 0 ? [`failures=${failures.length}`] : ["all_gates_green"],
      timestamp: new Date().toISOString(),
    });
    ctxMutable = { ...ctxMutable, prev_hash: w.currentPrevHash };
    persistCtxTail(ctxMutable, w.currentPrevHash);
  });

  return { status: "gates_verify_done", failures };
}
