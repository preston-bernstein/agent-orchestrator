import { afterEach, describe, expect, it } from "vitest";
import { CliArgError, parseArgs } from "../../src/cli/args.js";

const ORIG = process.env.ORCH_DRY_PLAN;

afterEach(() => {
  if (ORIG === undefined) delete process.env.ORCH_DRY_PLAN;
  else process.env.ORCH_DRY_PLAN = ORIG;
});

describe("parseArgs (Phase 4 task 27 — CLI flags)", () => {
  it("default: nothing set → both flags false; default lane = dry-plan", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs([]);
    expect(a.dryPlan).toBe(false);
    expect(a.execute).toBe(false);
    expect(a.spec).toBeUndefined();
  });

  it("--dry-plan sets dryPlan true", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--dry-plan"]);
    expect(a.dryPlan).toBe(true);
    expect(a.execute).toBe(false);
  });

  it("--execute sets execute true", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--execute"]);
    expect(a.execute).toBe(true);
    expect(a.dryPlan).toBe(false);
  });

  it("--spec <path> captured", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--spec", "specs/no-op.md"]);
    expect(a.spec).toBe("specs/no-op.md");
  });

  it("--spec without arg throws CliArgError", () => {
    delete process.env.ORCH_DRY_PLAN;
    expect(() => parseArgs(["--spec"])).toThrow(CliArgError);
    expect(() => parseArgs(["--spec", "--dry-plan"])).toThrow(CliArgError);
  });

  it("--reason <text> captured", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--reason", "human approval ok"]);
    expect(a.reason).toBe("human approval ok");
  });

  it("--dry-plan + --execute together throws CliArgError (mutex)", () => {
    delete process.env.ORCH_DRY_PLAN;
    expect(() => parseArgs(["--dry-plan", "--execute"])).toThrow(CliArgError);
  });

  it("ORCH_DRY_PLAN=1 env triggers dry-plan even w/o flag", () => {
    process.env.ORCH_DRY_PLAN = "1";
    const a = parseArgs([]);
    expect(a.dryPlan).toBe(true);
  });

  it("ORCH_DRY_PLAN=1 + --execute throws (mutex env vs flag)", () => {
    process.env.ORCH_DRY_PLAN = "1";
    expect(() => parseArgs(["--execute"])).toThrow(CliArgError);
  });

  it("collects unknown flags without throwing", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--made-up", "--also-fake", "--dry-plan"]);
    expect(a.unknown).toEqual(["--made-up", "--also-fake"]);
    expect(a.dryPlan).toBe(true);
  });
});
