import { describe, expect, it } from "vitest";
import {
  inngest,
  orchEventNames,
  eventSchemas,
} from "../../src/inngest/client.js";

describe("inngest client (I2)", () => {
  it("registers app id agent-orchestrator", () => {
    expect(inngest.id).toBe("agent-orchestrator");
  });

  it("declares orch + approval/cancel event names (ADR 0002 + gates.verify)", () => {
    expect(orchEventNames.sort()).toEqual(
      [
        "orch/dry-plan.requested",
        "orch/gates.verify.requested",
        "orch/run.requested",
        "orch/approve.spring",
        "orch/approve.react",
        "orch/cancel.requested",
      ].sort(),
    );
  });

  it("dry-plan + run schemas accept valid runId/specSlug/repo", () => {
    const validRunId = "11111111-2222-4333-8444-555555555555";
    const dryPlan = eventSchemas["orch/dry-plan.requested"].data.parse({
      runId: validRunId,
      specSlug: "2026-05-04-feature",
      repo: "spring-api",
      specPath: "fixtures/no-op.md",
    });
    expect(dryPlan.runId).toBe(validRunId);

    const run = eventSchemas["orch/run.requested"].data.parse({
      runId: validRunId,
      specSlug: "2026-05-04-feature",
      repo: "react-ui",
      specPath: "fixtures/no-op.md",
      reason: "user-initiated",
    });
    expect(run.repo).toBe("react-ui");
    expect(run.reason).toBe("user-initiated");
  });

  it("rejects unknown repo (allowlist guard)", () => {
    expect(() =>
      eventSchemas["orch/dry-plan.requested"].data.parse({
        runId: "11111111-2222-4333-8444-555555555555",
        specSlug: "x",
        repo: "rogue-repo",
        specPath: "x.md",
      }),
    ).toThrow();
  });

  it("gates.verify accepts optional gateKinds", () => {
    const validRunId = "11111111-2222-4333-8444-555555555555";
    const parsed = eventSchemas["orch/gates.verify.requested"].data.parse({
      runId: validRunId,
      specSlug: "x",
      repo: "agent-orchestrator",
      specPath: "fixtures/no-op.md",
      gateKinds: ["heavy"],
    });
    expect(parsed.gateKinds).toEqual(["heavy"]);
  });

  it("rejects malformed runId (uuid guard)", () => {
    expect(() =>
      eventSchemas["orch/run.requested"].data.parse({
        runId: "not-a-uuid",
        specSlug: "x",
        repo: "spring-api",
        specPath: "x.md",
      }),
    ).toThrow();
  });
});

describe("inngest client approval/cancel schemas", () => {
  it("approve.spring requires diffHash + approver", () => {
    expect(() =>
      eventSchemas["orch/approve.spring"].data.parse({
        runId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow();
    const ok = eventSchemas["orch/approve.spring"].data.parse({
      runId: "11111111-2222-4333-8444-555555555555",
      diffHash: "sha256:abc",
      approver: "preston",
    });
    expect(ok.diffHash).toBe("sha256:abc");
  });

  it("cancel requires reason (mandatory)", () => {
    expect(() =>
      eventSchemas["orch/cancel.requested"].data.parse({
        runId: "11111111-2222-4333-8444-555555555555",
      }),
    ).toThrow();
  });
});
