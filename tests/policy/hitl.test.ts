import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditWriter } from "../../src/audit/jsonl.js";
import { verifyChain } from "../../src/audit/verify.js";
import { CliArgError } from "../../src/cli/args.js";
import {
  assertDangerApplyPolicy,
  classifyHitl,
  auditHitlEscalation,
} from "../../src/policy/hitl.js";

const tmpRoot = path.join(process.cwd(), "runs", "_test_hitl");

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("classifyHitl", () => {
  it("danger_apply → C1 + approval", () => {
    expect(classifyHitl({ kind: "danger_apply" })).toEqual({
      hitl_category: "C1",
      requires_approval: true,
    });
  });

  it("first_live_tf → C4", () => {
    expect(classifyHitl({ kind: "first_live_tf" })).toEqual({
      hitl_category: "C4",
      requires_approval: true,
    });
  });

  it("restricted_path_touch → C3", () => {
    expect(
      classifyHitl({ kind: "restricted_path_touch", paths: [".env"] }),
    ).toEqual({
      hitl_category: "C3",
      requires_approval: true,
    });
  });
});

describe("assertDangerApplyPolicy (task 32)", () => {
  it("no-op when dangerApply false", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: false,
        dryPlan: true,
        dangerApply: false,
      }),
    ).not.toThrow();
  });

  it("throws when danger + dry-plan", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: false,
        dryPlan: true,
        dangerApply: true,
        reason: "x",
      }),
    ).toThrow(CliArgError);
  });

  it("throws when danger w/o execute", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: false,
        dryPlan: false,
        dangerApply: true,
        reason: "approved in standup",
      }),
    ).toThrow(CliArgError);
  });

  it("throws when danger w/o reason", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: true,
        dryPlan: false,
        dangerApply: true,
      }),
    ).toThrow(CliArgError);
  });

  it("dryPlan+execute+dangerApply+reason throws on dry-plan branch (kills L100 mutants)", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: true,
        dryPlan: true,
        dangerApply: true,
        reason: "non-empty",
      }),
    ).toThrow(/dry-plan/);
  });

  it("throws when reason whitespace-only", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: true,
        dryPlan: false,
        dangerApply: true,
        reason: "   ",
      }),
    ).toThrow(CliArgError);
  });

  it("passes execute + danger + reason", () => {
    expect(() =>
      assertDangerApplyPolicy({
        execute: true,
        dryPlan: false,
        dangerApply: true,
        reason: "ticket ORCH-1 approved",
      }),
    ).not.toThrow();
  });
});

describe("auditHitlEscalation — kill mutants (L78 reason slice)", () => {
  it("danger_reason longer than 200 chars is sliced (kills L78 .slice removal)", () => {
    const runDir = path.join(tmpRoot, "audit-slice");
    mkdirSync(runDir, { recursive: true });
    const p = path.join(runDir, "audit.jsonl");
    const w = new AuditWriter({ path: p });
    const longReason = "x".repeat(500);
    auditHitlEscalation(w, "run-slice", {
      signal: { kind: "danger_apply" },
      danger_reason: longReason,
    });
    const raw = readFileSync(p, "utf8");
    // Find the reason= token, slice off the trailing JSON delimiter.
    const m = raw.match(/"reason=([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m?.[1]?.length).toBe(200);
  });
});

describe("auditHitlEscalation", () => {
  it("writes hitl_escalation + chain valid", () => {
    const runDir = path.join(tmpRoot, "audit-1");
    mkdirSync(runDir, { recursive: true });
    const p = path.join(runDir, "audit.jsonl");
    const w = new AuditWriter({ path: p });
    auditHitlEscalation(w, "run-1", {
      signal: { kind: "danger_apply" },
      danger_reason: "human signed off",
    });
    const v = verifyChain(p);
    expect(v.valid).toBe(true);
    const raw = readFileSync(p, "utf8");
    expect(raw).toMatch(/"step":"hitl_escalation"/);
    expect(raw).toMatch(/hitl_category=C1/);
    expect(raw).toMatch(/signal=danger_apply/);
    expect(raw).toMatch(/reason=human signed off/);
  });

  it("note longer than 200 chars is sliced (kills L75 .slice removal)", () => {
    const runDir = path.join(tmpRoot, "audit-note");
    mkdirSync(runDir, { recursive: true });
    const p = path.join(runDir, "audit.jsonl");
    const w = new AuditWriter({ path: p });
    const longNote = "n".repeat(400);
    auditHitlEscalation(w, "run-note", {
      signal: { kind: "first_live_tf" },
      note: longNote,
    });
    const raw = readFileSync(p, "utf8");
    const m = raw.match(/"note=([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m?.[1]?.length).toBe(200);
  });
});
