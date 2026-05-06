import { afterEach, describe, expect, it } from "vitest";
import { CliArgError, parseArgs } from "../../src/cli/args.js";

const ORIG = process.env.ORCH_DRY_PLAN;

afterEach(() => {
  if (ORIG === undefined) delete process.env.ORCH_DRY_PLAN;
  else process.env.ORCH_DRY_PLAN = ORIG;
});

describe("parseArgs reason validation", () => {
  it("--reason without value throws", () => {
    delete process.env.ORCH_DRY_PLAN;
    expect(() => parseArgs(["--reason"])).toThrow(CliArgError);
  });

  it("--reason with flag-like value throws", () => {
    delete process.env.ORCH_DRY_PLAN;
    expect(() => parseArgs(["--reason", "--dry-plan"])).toThrow(CliArgError);
    expect(() => parseArgs(["--reason", "--"])).toThrow(CliArgError);
  });

  it("--reason value may end with --", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--reason", "ticket-42--"]);
    expect(a.reason).toBe("ticket-42--");
  });
});

describe("parseArgs loop and unknown handling", () => {
  it("loop visits each argv element exactly once for unknown flags", () => {
    delete process.env.ORCH_DRY_PLAN;
    const a = parseArgs(["--execute", "leftover"]);
    expect(a.execute).toBe(true);
    expect(a.unknown).toEqual(["leftover"]);
  });

  it("default branch does not push iterator holes (undefined slots)", () => {
    delete process.env.ORCH_DRY_PLAN;
    const sparse: string[] = [];
    sparse[1] = "--dry-plan";
    const a = parseArgs(sparse);
    expect(a.dryPlan).toBe(true);
    expect(a.unknown).toEqual([]);
  });
});
