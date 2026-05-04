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
 * Phase 6 — Scenario B (UI-only) end-to-end against mocks.
 *
 * Vault canon: `Build/Playbook.md` §Phase 6 ("Test on Scenario B (UI-only)
 * and Scenario C (cross-repo) against mocks").
 *
 * Scenario B shape (`Multi-Agent Orchestration PoC#Demo scenarios`):
 *   - Single repo (react-ui).
 *   - No spring task.
 *   - No `consumes_contract` (UI internal change).
 *   - Expected: react supervisor green; integration step skipped w/
 *     `no_contract_no_consumer`.
 */

const tmpRoot = path.join(process.cwd(), "runs", "_test_scenario_B");

const SNAPSHOT = {
  docPath: "docs/playbook-expectations.md",
  docSha256: "a".repeat(64),
  vault_git_sha: "1507957",
  vault_cut_date: "2026-05-04",
};

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

const SCENARIO_B_PLAN: PlannerOutputT = {
  status: "ready",
  rationale: "scenario B — UI-only internal change",
  tasks: [
    {
      id: "react-T1",
      spec_slug: "ui-button-color",
      repo: "react-ui",
      supervisor: "react",
      title: "tweak button color",
      paths: ["src/components/**", "src/components/**/*.test.tsx"],
      depends_on: [],
    },
  ],
  path_ownership_map: {
    "react-T1": ["src/components/**", "src/components/**/*.test.tsx"],
  },
  refusals: [],
};

describe("Scenario B — UI-only (Phase 6 mock E2E)", () => {
  it("react supervisor green; integration_skipped no_contract_no_consumer", async () => {
    const runId = "scenario-B-happy";
    const runDir = path.join(tmpRoot, runId);
    mkdirSync(runDir, { recursive: true });
    const reactCwd = path.join(tmpRoot, "_managed", "react-ui");
    mkdirSync(reactCwd, { recursive: true });
    const ctx = initRunContext({
      run_id: runId,
      started_at: "2026-05-04T09:00:00Z",
      cli_flags: { execute: true },
      expectations_snapshot: SNAPSHOT,
      audit_path: path.join(runDir, "audit.jsonl"),
      state_file_path: path.join(runDir, "state.json"),
      specs: [],
    });
    ctx.path_ownership_map = SCENARIO_B_PLAN.path_ownership_map;
    atomicWriteJson({ path: ctx.state_file_path, data: ctx });

    const auditWriter = new AuditWriter({
      path: ctx.audit_path,
      prevHash: ctx.prev_hash,
    });
    const branchResult = await runSupervisorBranch(
      {
        ctx,
        plan: SCENARIO_B_PLAN,
        cwds: { react: reactCwd },
        runDir,
        auditWriter,
      },
      {
        subagentCompletion: async () => ({
          status: "patch" as const,
          rationale: "mock UI-only patch",
          patch: "diff --git a/src/components/Btn.tsx b/...\n",
          files_touched: ["src/components/Btn.tsx"],
          refusals: [],
          context_request: [],
        }),
        fixSubagentCompletion: mockFixSubagentCompletion(),
        exec: mockExec({ exit: 0, stdout: "vitest passed" }),
      },
    );

    expect(branchResult.aggregateStatus).toBe("green");
    expect(branchResult.gate_contract_published).toBe(false);
    expect(branchResult.contract_producers).toEqual([]);
    const sup = branchResult.supervisors[0];
    if (!sup) throw new Error("missing supervisor result");
    expect(sup.supervisorId).toBe("react");
    expect(sup.stack).toBe("ts-react-vite");
    expect(sup.result.output.status).toBe("done");
    expect(sup.result.output.pending_diff_path).toBeDefined();

    const integ = await runIntegrationStep({
      ctx,
      plan: SCENARIO_B_PLAN,
      branchResult,
      cwds: { react: reactCwd },
      auditWriter,
    });
    expect(integ.ran).toBe(false);
    if (integ.ran) throw new Error("expected ran:false");
    expect(integ.reason).toBe("no_contract_no_consumer");

    const audit = readFileSync(ctx.audit_path, "utf8");
    expect(audit).toMatch(/"step":"supervisor_spawn".+react/);
    expect(audit).toMatch(/"step":"gate_invocation"/);
    expect(audit).toMatch(/"step":"supervisor_done"/);
    expect(audit).toMatch(
      /"step":"integration_skipped".+reason=no_contract_no_consumer/,
    );
    expect(audit).not.toMatch(/"step":"integration_run"/);
    expect(audit).not.toMatch(/"step":"supervisor_blocked"/);

    const verify = verifyChain(ctx.audit_path);
    expect(verify.valid).toBe(true);
  });
});
