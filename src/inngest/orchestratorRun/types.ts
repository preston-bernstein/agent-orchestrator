/** Minimal step surface exercised by orch-run integration tests + handler. */
export type OrchStep = {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
  waitForEvent(
    id: string,
    args: { event: string; match: string; timeout: string },
  ): Promise<{ name: string; data: unknown }>;
};

export type OrchGateKind = "preflight" | "fast" | "heavy";

export type OrchRunEvent =
  | {
      name: "orch/dry-plan.requested";
      data: OrchOrchestrateEventData;
    }
  | {
      name: "orch/run.requested";
      data: OrchOrchestrateEventData;
    }
  | {
      name: "orch/gates.verify.requested";
      data: OrchGatesVerifyEventData;
    };

export interface OrchOrchestrateEventData {
  runId: string;
  specSlug: string;
  repo: "spring-api" | "react-ui" | "agent-orchestrator";
  specPath: string;
  reason?: string;
  dangerApply?: boolean;
}

export interface OrchGatesVerifyEventData {
  runId: string;
  specSlug: string;
  repo: "spring-api" | "react-ui" | "agent-orchestrator";
  specPath: string;
  gateKinds?: readonly OrchGateKind[];
}

export type OrchRunResult =
  | { status: "skipped_no_change_needed"; reason: string }
  | { status: "dry_plan_done"; planPath: string }
  | { status: "green" }
  | {
      status: "gates_verify_done";
      failures: readonly { supervisorId: string; kind: string; exit: number }[];
    };

export type OrchRunOverrides = Partial<{
  runPlannerBranch: typeof import("../../workflows/plannerBranch.js").runPlannerBranch;
  runExecuteLane: typeof import("../../workflows/executeLane.js").runExecuteLane;
  loadManagedRepos: () => Promise<
    Awaited<ReturnType<typeof import("../../config/managedRepos.js").loadManagedRepos>>
  >;
  /** Test seam — default `runQuality` shells real stacks. */
  gatesVerifyQuality: typeof import("../../gates/runQuality.js").runQuality;
}>;
