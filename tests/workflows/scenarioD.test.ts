import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSupervisorBranch } from "../../src/workflows/supervisorBranch.js";
import { runIntegrationStep } from "../../src/workflows/integrationStep.js";
import { mockFixSubagentCompletion } from "../../src/agents/fixSubagent.js";
import { mockExec } from "../../src/gates/runQuality.js";
import { initRunContext } from "../../src/runs/orchestratorContext.js";
import { atomicWriteJson } from "../../src/runs/state.js";
import { AuditWriter } from "../../src/audit/jsonl.js";
import { verifyChain } from "../../src/audit/verify.js";
import type { PlannerOutputT } from "../../src/agents/planner.schema.js";

/**
 * Phase 8 closeout — Scenario D (test-only change) end-to-end against mocks.
 *
 * Vault canon: `Build/Playbook.md` §Phase 8 ("Run scenarios A/B/C/D/E
 * end-to-end"); `Orchestration PoC Demo Scorecard.md` ("Test-only change
 * (Jest + Stryker thresholds)").
 *
 * Scenario D shape:
 *   - Single repo (spring-api), subagent patches test files only.
 *   - No `contract_artifact`, no `consumes_contract`.
 *   - Test writes a `scenario_tag` audit event so the Phase 8/9 scorecard
 *     classifier can distinguish D from A (audit shape is otherwise identical
 *     to Scenario A — same supervisor lane, no contract).
 */

const tmpRoot = path.join(process.cwd(), "runs", "_test_scenario_D");

const SNAPSHOT = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const SCENARIO_D_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "scenario D — test-only change",
  tasks: [
    {
      id: "spring-T1",
      spec_slug: "user-coverage-bump",
      repo: "spring-api",
      supervisor: "spring",
      title: "raise coverage on UserService",
      paths: ["src/test/java/user/**"],
      depends_on: [],
    },
  ],
  path_ownership_map: {
    "spring-T1": ["src/test/java/user/**"],
  },
  refusals: [],
};

describe("Scenario D — test-only change (Phase 8 mock E2E)", () => {
  it("spring supervisor green; integration skipped; scenario_tag=D in audit", async () => {
    const runId = "scenario-D-happy";
    const runDir = path.join(tmpRoot, runId);
    mkdirSync(runDir, { recursive: true });
    const springCwd = path.join(tmpRoot, "_managed", "spring-api");
    mkdirSync(springCwd, { recursive: true });

    const ctx = initRunContext({
      run_id: runId,
      started_at: "2026-05-04T09:00:00Z",
      cli_flags: { execute: true },
      expectations_snapshot: SNAPSHOT,
      audit_path: path.join(runDir, "audit.jsonl"),
      state_file_path: path.join(runDir, "state.json"),
      specs: [],
    });
    ctx.path_ownership_map = SCENARIO_D_PLAN.path_ownership_map;
    atomicWriteJson({ path: ctx.state_file_path, data: ctx });

    const auditWriter = new AuditWriter({
      path: ctx.audit_path,
      prevHash: ctx.prev_hash,
    });

    auditWriter.write({
      run_id: ctx.run_id,
      step: "scenario_tag",
      agent: "system",
      decisions: ["scenario=D"],
      timestamp: "2026-05-04T09:00:01Z",
    });

    const branchResult = await runSupervisorBranch(
      {
        ctx,
        plan: SCENARIO_D_PLAN,
        cwds: { spring: springCwd },
        runDir,
        auditWriter,
      },
      {
        subagentCompletion: async () => ({
          status: "patch" as const,
          rationale: "mock test-only patch",
          patch:
            "diff --git a/src/test/java/user/UserServiceTest.java b/...\n",
          files_touched: ["src/test/java/user/UserServiceTest.java"],
          refusals: [],
          context_request: [],
        }),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "tests green; coverage 0.91" }),
      },
    );

    expect(branchResult.aggregateStatus).toBe("green");
    expect(branchResult.gate_contract_published).toBe(false);
    const sup = branchResult.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.supervisorId).toBe("spring");
    expect(sup.stack).toBe("java-spring");
    expect(sup.result.output.pending_diff_path).toBeDefined();

    const integ = await runIntegrationStep({
      ctx,
      plan: SCENARIO_D_PLAN,
      branchResult,
      cwds: { spring: springCwd },
      auditWriter,
    });
    expect(integ.ran).toBe(false);
    if (integ.ran) throw new Error("expected integration ran:false");
    expect(integ.reason).toBe("no_contract_no_consumer");

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"scenario_tag".+scenario=D/);
    expect(audit).toMatch(/"step":"supervisor_spawn".+spring/);
    expect(audit).toMatch(/"step":"gate_invocation"/);
    expect(audit).toMatch(/"step":"supervisor_done"/);
    expect(audit).toMatch(
      /"step":"integration_skipped".+reason=no_contract_no_consumer/,
    );
    expect(audit).not.toMatch(/"step":"integration_run"/);
    expect(audit).not.toMatch(/"step":"supervisor_blocked"/);

    expect(verifyChain(ctx.audit_path).valid).toBe(true);
  });
});
