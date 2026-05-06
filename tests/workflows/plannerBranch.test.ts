import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CliFlagConflict,
  SupervisorNotWiredError,
  runPlannerBranch,
  supervisorSpawnGuard,
} from "../../src/workflows/plannerBranch.js";
import {
  mockPlannerCompletion,
} from "../../src/agents/planner/index.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { verifyChain } from "../../src/audit/verify.js";
import { SNAPSHOT } from "./fixtures.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_planner_branch");

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function makeRun(opts: {
  runId: string;
  cliFlags: Record<string, unknown>;
  specs: { slug: string; tasksBody: string }[];
}) {
  const runDir = path.join(tmpRoot, opts.runId);
  mkdirSync(runDir, { recursive: true });
  const tasksDir = path.join(tmpRoot, "_specs");
  mkdirSync(tasksDir, { recursive: true });
  const specs = opts.specs.map((s) => {
    const tasks_path = path.join(tasksDir, `${s.slug}.md`);
    writeFileSync(tasks_path, s.tasksBody, "utf8");
    return {
      slug: s.slug,
      repo: "agent-orchestrator" as const,
      stack: "ts-node",
      requirements_path: tasks_path,
      tasks_path,
      design_path: tasks_path,
      hash: "0".repeat(64),
    };
  });
  const ctx = initRunContext({
    run_id: opts.runId,
    started_at: "2026-05-04T09:00:00Z",
    cli_flags: opts.cliFlags,
    expectations_snapshot: SNAPSHOT,
    audit_path: path.join(runDir, "audit.jsonl"),
    state_file_path: path.join(runDir, "state.json"),
    specs,
  });
  atomicWriteJson({ path: ctx.state_file_path, data: ctx });
  return { ctx, runDir };
}

const cleanGit = async () => "";
const fakeReader = (body: string) => async () => body;

describe("runPlannerBranch — A4 dry-plan path (Phase 4 task 28)", () => {
  it("emits plan.json + audit dry_plan; never crosses into execution_started", async () => {
    const { ctx, runDir } = makeRun({
      runId: "dry-1",
      cliFlags: { dry_plan: true, execute: false },
      specs: [{ slug: "feat-x", tasksBody: "- [ ] open task\n- [x] done\n" }],
    });
    const completion = vi.fn(mockPlannerCompletion(ctx.specs));
    const out = await runPlannerBranch({
      ctx,
      cliFlags: ctx.cli_flags,
      completion,
      runDir,
      dryRunDeps: { gitStatus: cleanGit },
    });
    expect(out.kind).toBe("dry_plan");
    if (out.kind !== "dry_plan") throw new Error();
    expect(out.planPath.endsWith("plan.json")).toBe(true);
    const planRaw = readFileSync(out.planPath, "utf8");
    const plan = JSON.parse(planRaw) as { status: string; tasks: unknown[] };
    expect(plan.status).toBe("ready");
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(completion).toHaveBeenCalledTimes(1);

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"planner_branch:start"/);
    expect(audit).toMatch(/"step":"planner_emitted"/);
    expect(audit).toMatch(/"step":"dry_plan"/);
    expect(audit).not.toMatch(/"step":"execution_started"/);

    const verify = verifyChain(ctx.audit_path);
    expect(verify.valid).toBe(true);
  });
});

describe("runPlannerBranch — O5 skipped_no_change_needed", () => {
  it("does NOT call completion; audits planner_skipped only", async () => {
    const { ctx, runDir } = makeRun({
      runId: "skip-1",
      cliFlags: { dry_plan: true },
      specs: [{ slug: "no-op", tasksBody: "- [x] one\n- [x] two\n" }],
    });
    const completion = vi.fn();
    const out = await runPlannerBranch({
      ctx,
      cliFlags: ctx.cli_flags,
      completion,
      runDir,
      dryRunDeps: { gitStatus: cleanGit },
    });
    expect(out.kind).toBe("skipped");
    expect(completion).not.toHaveBeenCalled();
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"planner_skipped"/);
    expect(audit).not.toMatch(/"step":"planner_emitted"/);
    expect(audit).not.toMatch(/"step":"dry_plan"/);
  });
});

describe("runPlannerBranch — execute lane (A4 risky)", () => {
  it("audits execution_started after planner_emitted", async () => {
    const { ctx, runDir } = makeRun({
      runId: "exec-1",
      cliFlags: { execute: true },
      specs: [{ slug: "feat-x", tasksBody: "- [ ] open task\n" }],
    });
    const completion = vi.fn(mockPlannerCompletion(ctx.specs));
    const out = await runPlannerBranch({
      ctx,
      cliFlags: ctx.cli_flags,
      completion,
      runDir,
      dryRunDeps: { gitStatus: cleanGit },
    });
    expect(out.kind).toBe("execution_started");
    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"execution_started"/);
    expect(audit).not.toMatch(/"step":"dry_plan"/);
  });

  it("throws CliFlagConflict when both flags set", async () => {
    const { ctx, runDir } = makeRun({
      runId: "conflict-1",
      cliFlags: { dry_plan: true, execute: true },
      specs: [{ slug: "x", tasksBody: "- [ ] x\n" }],
    });
    await expect(
      runPlannerBranch({
        ctx,
        cliFlags: { dry_plan: true, execute: true },
        runDir,
      }),
    ).rejects.toBeInstanceOf(CliFlagConflict);
  });
});

describe("runPlannerBranch — resolveCompletion (MOCK_TF seam)", () => {
  it("uses mockPlannerCompletion when MOCK_TF=1 and no completion passed", async () => {
    const prev = process.env.MOCK_TF;
    process.env.MOCK_TF = "1";
    try {
      const { ctx, runDir } = makeRun({
        runId: "mock-tf-exec",
        cliFlags: { execute: true },
        specs: [{ slug: "feat-x", tasksBody: "- [ ] open task\n" }],
      });
      const out = await runPlannerBranch({
        ctx,
        cliFlags: ctx.cli_flags,
        runDir,
        dryRunDeps: { gitStatus: cleanGit },
      });
      expect(out.kind).toBe("execution_started");
    } finally {
      if (prev === undefined) delete process.env.MOCK_TF;
      else process.env.MOCK_TF = prev;
    }
  });

  it("throws when execute path has no completion and MOCK_TF is unset", async () => {
    const prev = process.env.MOCK_TF;
    delete process.env.MOCK_TF;
    try {
      const { ctx, runDir } = makeRun({
        runId: "no-tf",
        cliFlags: { execute: true },
        specs: [{ slug: "feat-x", tasksBody: "- [ ] open task\n" }],
      });
      await expect(
        runPlannerBranch({
          ctx,
          cliFlags: ctx.cli_flags,
          runDir,
          dryRunDeps: { gitStatus: cleanGit },
        }),
      ).rejects.toThrow(/real-TF planner completion not wired/);
    } finally {
      if (prev === undefined) delete process.env.MOCK_TF;
      else process.env.MOCK_TF = prev;
    }
  });
});

describe("supervisorSpawnGuard (task 34 abuse vitest)", () => {
  it("throws SupervisorNotWiredError when cli_flags.execute !== true", () => {
    expect(() => supervisorSpawnGuard({})).toThrow(SupervisorNotWiredError);
    expect(() => supervisorSpawnGuard({ execute: false })).toThrow(
      SupervisorNotWiredError,
    );
    expect(() => supervisorSpawnGuard({ execute: "true" })).toThrow(
      SupervisorNotWiredError,
    );
  });

  it("does NOT throw when cli_flags.execute === true", () => {
    expect(() => supervisorSpawnGuard({ execute: true })).not.toThrow();
  });
});

describe("runPlannerBranch — A4 mutation gate (task 29: dry-plan ⇒ no managed-repo subprocess)", () => {
  /**
   * Structural proof: workflow + planner code path has zero `node:
   * child_process` calls outside `plannerDryRun`'s `git status` (provably
   * skipped here via injected `gitStatus` fake). Any future supervisor
   * spawn must pass `supervisorSpawnGuard` which refuses unless
   * `cli_flags.execute === true` (separately tested below).
   */
  it("dry-plan run completes w/ injected fakes; never reaches execution_started branch", async () => {
    const { ctx, runDir } = makeRun({
      runId: "no-spawn-1",
      cliFlags: { dry_plan: true },
      specs: [
        {
          slug: "feat-y",
          tasksBody: "- [ ] open task; O5 returns skip:false\n",
        },
      ],
    });
    const completion = vi.fn(mockPlannerCompletion(ctx.specs));
    const out = await runPlannerBranch({
      ctx,
      cliFlags: ctx.cli_flags,
      completion,
      runDir,
      dryRunDeps: {
        gitStatus: cleanGit,
        readTasks: fakeReader("- [ ] open\n"),
      },
    });
    expect(out.kind).toBe("dry_plan");
    if (out.kind !== "dry_plan") return;
    expect(completion).toHaveBeenCalledTimes(1);

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"dry_plan"/);
    expect(audit).not.toMatch(/"step":"execution_started"/);
    expect(audit).not.toMatch(/"step":"supervisor_spawn"/);

    const plan = JSON.parse(readFileSync(out.planPath, "utf8")) as {
      tasks: { paths: string[] }[];
    };
    expect(plan.tasks.length).toBeGreaterThan(0);
  });
});
