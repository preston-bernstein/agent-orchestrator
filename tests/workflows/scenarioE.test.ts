import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPlannerBranch } from "../../src/workflows/plannerBranch.js";
import { mockPlannerCompletion } from "../../src/agents/planner.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { SNAPSHOT } from "./fixtures.js";

/**
 * Phase 8 closeout — Scenario E (refactor no-op, planner skip via O5).
 *
 * Vault canon: `Build/Playbook.md` §Phase 8; `Orchestration PoC Demo
 * Scorecard.md` ("Refactor with no behavior change (planner no-op O5)");
 * `Build/Patterns/O5-planner-dry-run.md`.
 *
 * Scenario E shape:
 *   - All tasks pre-checked, working tree clean, no prior fix-loop.
 *   - `runPlannerBranch` consults `plannerDryRun` ⇒ returns `skip:true`.
 *   - Outcome: `skipped` — `planner_skipped` audit event, planner LLM
 *     completion never invoked, **zero** `supervisor_spawn` events,
 *     **zero** `dry_plan` / `execution_started` events (workflow short-circuits
 *     before plan emit).
 *   - Audit chain valid; scorecard classifier reads `planner_skipped` ⇒ E.
 */

const tmpRoot = path.join(process.cwd(), "runs", "_test_scenario_E");

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("Scenario E — refactor no-op / O5 skip (Phase 8 mock E2E)", () => {
  it("plannerDryRun fires; outcome=skipped; no supervisor_spawn; chain valid", async () => {
    const runId = "scenario-E-skip";
    const runDir = path.join(tmpRoot, runId);
    mkdirSync(runDir, { recursive: true });
    const tasksDir = path.join(tmpRoot, "_specs");
    mkdirSync(tasksDir, { recursive: true });
    const tasksPath = path.join(tasksDir, "refactor-noop.md");
    writeFileSync(tasksPath, "- [x] 1. rename foo\n- [x] 2. inline bar\n", "utf8");

    const ctx = initRunContext({
      run_id: runId,
      started_at: "2026-05-04T09:00:00Z",
      cli_flags: { execute: true },
      expectations_snapshot: SNAPSHOT,
      audit_path: path.join(runDir, "audit.jsonl"),
      state_file_path: path.join(runDir, "state.json"),
      specs: [
        {
          slug: "refactor-noop",
          repo: "agent-orchestrator",
          stack: "ts-node",
          requirements_path: tasksPath,
          tasks_path: tasksPath,
          design_path: tasksPath,
          hash: "0".repeat(64),
        },
      ],
    });
    atomicWriteJson({ path: ctx.state_file_path, data: ctx });

    const completion = vi.fn(mockPlannerCompletion(ctx.specs));
    const out = await runPlannerBranch({
      ctx,
      cliFlags: ctx.cli_flags,
      runDir,
      completion,
      dryRunDeps: {
        gitStatus: async () => "",
        readTasks: async () => "- [x] 1. rename foo\n- [x] 2. inline bar\n",
      },
    });

    expect(out.kind).toBe("skipped");
    if (out.kind !== "skipped") throw new Error("expected skipped outcome");
    expect(out.reason).toMatch(/all tasks checked/);
    expect(completion).not.toHaveBeenCalled();

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"planner_branch:start"/);
    expect(audit).toMatch(/"step":"planner_skipped"/);
    expect(audit).not.toMatch(/"step":"planner_emitted"/);
    expect(audit).not.toMatch(/"step":"dry_plan"/);
    expect(audit).not.toMatch(/"step":"execution_started"/);
    expect(audit).not.toMatch(/"step":"supervisor_spawn"/);

    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});
