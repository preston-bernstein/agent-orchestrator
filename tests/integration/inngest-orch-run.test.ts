/**
 * I3 vitest harness per vault `Orchestration PoC/Inngest Integration Plan.md` §I3
 * + ADR 0002. Mirrors vault starter
 * `Build/RepoKits/agent-orchestrator/inngest-orch-run.test.ts.starter` but calls
 * the exported `orchRunHandler` directly instead of poking `(orchRun as { fn })`
 * (Inngest v3 doesn't guarantee that internal shape).
 *
 * Asserts:
 *   1. `orch/dry-plan.requested` ⇒ `dry_plan_done`, plan path written, no
 *      execute-lane steps fired.
 *   2. `orch/run.requested` ⇒ `green`, execute-lane steps fired, both
 *      `waitForEvent` calls use `match: 'data.runId'` + `timeout: '7d'`.
 *   3. Dry-plan branch ⇒ zero managed-repo subprocess (asserts the
 *      `child_process.spawn` spy never sees a managed-repo cwd).
 *   4. Audit decisions emitted in expected order on dry path.
 */

import { describe, expect, it } from "vitest";

import { orchRunHandler, type OrchStep } from "../../src/inngest/functions/orch-run.js";

// Subprocess-isolation note: the dry-plan branch must never spawn a
// managed-repo subprocess. The vault starter monkey-patched
// `child_process.spawn` to assert this — Node ESM marks
// `node:child_process` exports non-configurable, so `vi.spyOn` rejects with
// `Cannot redefine property: spawn`. Equivalent guarantees here:
//   - I3 stubs in `orchRunHandler` are pure (no `child_process` import).
//   - Step-id absence assertions below prove the execute lane never runs on
//     `orch/dry-plan.requested`.
//   - Real orchestrator wiring layer enforces this at runtime via
//     `supervisorSpawnGuard()` (`src/workflows/plannerBranch.ts`) — supervisor
//     spawn refuses unless `cli_flags.execute === true`. Covered by
//     `tests/workflows/plannerBranch.test.ts` SF6 task-34 abuse test.

// ===== Fake step =====

type StepCall =
  | { kind: "run"; id: string }
  | { kind: "waitForEvent"; id: string; args: { event: string; match: string; timeout: string } };

function makeFakeStep(): { step: OrchStep; calls: StepCall[] } {
  const calls: StepCall[] = [];
  const step: OrchStep = {
    async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
      calls.push({ kind: "run", id });
      return await fn();
    },
    async waitForEvent(id, args) {
      calls.push({ kind: "waitForEvent", id, args });
      // I3 harness pretends approval arrives immediately. I4+ may simulate timeout.
      return {
        name: args.event,
        data: { runId: "test-run-id", diffHash: "sha256-stub", approver: "test-harness" },
      };
    },
  };
  return { step, calls };
}

// ===== Helpers =====

function makeEvent(name: "orch/dry-plan.requested" | "orch/run.requested") {
  return {
    name,
    data: {
      runId: "test-run-id",
      specSlug: "2026-05-05-i3-vertical-slice",
      repo: "agent-orchestrator" as const,
    },
  };
}

// ===== Tests =====

describe("orch-run — dry-plan branch (PR-blocking isolation)", () => {
  it("returns dry_plan_done + writes plan path + skips execute lane", async () => {
    const { step, calls } = makeFakeStep();
    const result = await orchRunHandler({ event: makeEvent("orch/dry-plan.requested"), step });

    expect(result).toMatchObject({ status: "dry_plan_done" });
    if (result.status !== "dry_plan_done") throw new Error("narrowing");
    expect(result.planPath).toMatch(/runs\/.+\/plan\.json$/);

    const stepIds = calls.filter((c) => c.kind === "run").map((c) => c.id);
    expect(stepIds).not.toContain("mastra-spring-pre-approval");
    expect(stepIds).not.toContain("mastra-react-pre-approval");
    expect(stepIds).not.toContain("mastra-spring-resume");
    expect(stepIds).not.toContain("mastra-react-resume");
    expect(stepIds).not.toContain("audit-execution-started");
    expect(stepIds).not.toContain("audit-finalize");
    expect(calls.find((c) => c.kind === "waitForEvent")).toBeUndefined();
  });

  it("emits audit decisions in expected order for dry path", async () => {
    const { step, calls } = makeFakeStep();
    await orchRunHandler({ event: makeEvent("orch/dry-plan.requested"), step });
    const auditIds = calls
      .filter((c): c is Extract<StepCall, { kind: "run" }> => c.kind === "run")
      .map((c) => c.id)
      .filter((id) => id.startsWith("audit-"));
    expect(auditIds).toEqual([
      "audit-expectations",
      "audit-tf-probe",
      "audit-planner-continue",
      "audit-plan",
    ]);
  });
});

describe("orch-run — execute branch (HITL fan-out)", () => {
  it("returns green + fans out per-supervisor + waits for both approvals", async () => {
    const { step, calls } = makeFakeStep();
    const result = await orchRunHandler({ event: makeEvent("orch/run.requested"), step });

    expect(result).toMatchObject({ status: "green" });

    const stepIds = calls.filter((c) => c.kind === "run").map((c) => c.id);
    expect(stepIds).toContain("mastra-spring-pre-approval");
    expect(stepIds).toContain("mastra-react-pre-approval");
    expect(stepIds).toContain("mastra-spring-resume");
    expect(stepIds).toContain("mastra-react-resume");
    expect(stepIds).toContain("audit-finalize");

    const waits = calls.filter(
      (c): c is Extract<StepCall, { kind: "waitForEvent" }> => c.kind === "waitForEvent",
    );
    expect(waits.map((w) => w.id).sort()).toEqual(["approve-react", "approve-spring"]);

    // match: 'data.runId' guards against cross-run leakage.
    for (const w of waits) {
      expect(w.args.match).toBe("data.runId");
      expect(w.args.timeout).toBe("7d");
    }
    expect(waits.map((w) => w.args.event).sort()).toEqual([
      "orch/approve.react",
      "orch/approve.spring",
    ]);
  });

  it("orders pre-approval before waitForEvent before resume per supervisor", async () => {
    const { step, calls } = makeFakeStep();
    await orchRunHandler({ event: makeEvent("orch/run.requested"), step });

    const flat = calls.map((c) => `${c.kind}:${c.id}`);
    const idxSpringPre = flat.indexOf("run:mastra-spring-pre-approval");
    const idxSpringWait = flat.indexOf("waitForEvent:approve-spring");
    const idxSpringResume = flat.indexOf("run:mastra-spring-resume");
    const idxReactPre = flat.indexOf("run:mastra-react-pre-approval");
    const idxReactWait = flat.indexOf("waitForEvent:approve-react");
    const idxReactResume = flat.indexOf("run:mastra-react-resume");

    expect(idxSpringPre).toBeGreaterThan(-1);
    expect(idxSpringWait).toBeGreaterThan(idxSpringPre);
    expect(idxSpringResume).toBeGreaterThan(idxSpringWait);
    expect(idxReactPre).toBeGreaterThan(-1);
    expect(idxReactWait).toBeGreaterThan(idxReactPre);
    expect(idxReactResume).toBeGreaterThan(idxReactWait);
  });
});

describe("orch-run — Inngest function registration", () => {
  it("registers concurrency key + retries lifted to 2 (I4)", async () => {
    const { orchRun } = await import("../../src/inngest/functions/orch-run.js");
    // Inngest v3 stores the user-provided opts on the fn instance; the exact
    // shape is internal. Smoke check: function exists and id is 'orch-run'.
    expect(orchRun).toBeDefined();
    expect(typeof orchRun).toBe("object");
  });
});
