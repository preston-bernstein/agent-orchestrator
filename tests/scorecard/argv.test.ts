import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScorecardArgv } from "../../src/scorecard/argv.js";

describe("parseScorecardArgv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults format + runsDir from RUNS_DIR", () => {
    vi.stubEnv("RUNS_DIR", "./my-runs");
    const r = parseScorecardArgv(["node", "scorecard"]);
    expect(r.format).toBe("default");
    expect(r.runsDir).toContain("my-runs");
  });

  it("--format json", () => {
    const r = parseScorecardArgv(["node", "scorecard", "--format", "json"]);
    expect(r.format).toBe("json");
  });

  it("--format other throws", () => {
    expect(() =>
      parseScorecardArgv(["node", "scorecard", "--format", "html"]),
    ).toThrow("--format accepts only json");
  });

  it("--since requires value", () => {
    expect(() => parseScorecardArgv(["node", "scorecard", "--since"])).toThrow(
      "--since requires",
    );
  });

  it("--since YYYY-MM-DD", () => {
    const r = parseScorecardArgv(["node", "scorecard", "--since", "2026-01-02"]);
    expect(r.since).toBe("2026-01-02");
  });

  it("--runs comma-separated trims", () => {
    const r = parseScorecardArgv(["node", "scorecard", "--runs", " a , b "]);
    expect(r.runIds).toEqual(["a", "b"]);
  });

  it("--runs requires value", () => {
    expect(() => parseScorecardArgv(["node", "scorecard", "--runs"])).toThrow("--runs requires");
  });

  it("--runs-dir resolves path", () => {
    const r = parseScorecardArgv(["node", "scorecard", "--runs-dir", "/tmp/x"]);
    expect(r.runsDir).toMatch(/[\\/]tmp[\\/]x$/);
  });

  it("--runs-dir requires value", () => {
    expect(() => parseScorecardArgv(["node", "scorecard", "--runs-dir"])).toThrow(
      "--runs-dir requires",
    );
  });

  it("--help throws help sentinel", () => {
    expect(() => parseScorecardArgv(["node", "scorecard", "--help"])).toThrow("help");
    expect(() => parseScorecardArgv(["node", "scorecard", "-h"])).toThrow("help");
  });

  it("unknown token is skipped without changing state", () => {
    vi.stubEnv("RUNS_DIR", "./runs-default");
    const r = parseScorecardArgv(["node", "scorecard", "--zzz"]);
    expect(r.format).toBe("default");
  });
});
