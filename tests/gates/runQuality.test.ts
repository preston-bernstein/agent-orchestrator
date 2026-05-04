import { describe, expect, it } from "vitest";
import { mockExec, runQuality } from "../../src/gates/runQuality.js";
import { javaSpringProfile } from "../../src/stacks/javaSpring.js";

describe("runQuality — profile dispatch", () => {
  it("selects qualityFastCmd for kind:'fast'", async () => {
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/spring", kind: "fast" },
      { exec: mockExec({ exit: 0, stdout: "BUILD SUCCESS" }) },
    );
    expect(out.cmd).toEqual(javaSpringProfile.qualityFastCmd);
    expect(out.exit).toBe(0);
    expect(out.kind).toBe("fast");
    expect(out.stack).toBe("java-spring");
  });

  it("selects qualityHeavyCmd for kind:'heavy'", async () => {
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/spring", kind: "heavy" },
      { exec: mockExec({ exit: 0 }) },
    );
    expect(out.cmd).toEqual(javaSpringProfile.qualityHeavyCmd);
  });

  it("selects preflightCmd for kind:'preflight'", async () => {
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/spring", kind: "preflight" },
      { exec: mockExec({ exit: 0 }) },
    );
    expect(out.cmd).toEqual(javaSpringProfile.preflightCmd);
  });
});

describe("runQuality — log truncation (edge 3)", () => {
  it("returns last 200 lines by default when stdout/stderr exceeds cap", async () => {
    const stdout = Array.from({ length: 500 }, (_v, i) => `line ${i}`).join("\n");
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/x", kind: "fast" },
      { exec: mockExec({ exit: 0, stdout }) },
    );
    const lines = out.log_tail.split("\n");
    expect(lines.length).toBe(200);
    expect(lines[0]).toMatch(/^line 30[01]$/);
    expect(lines[lines.length - 1]).toMatch(/^$/);
  });

  it("respects explicit logTailLines override", async () => {
    const stdout = Array.from({ length: 100 }, (_v, i) => `L${i}`).join("\n");
    const out = await runQuality(
      {
        profile: javaSpringProfile,
        cwd: "/tmp/x",
        kind: "fast",
        logTailLines: 10,
      },
      { exec: mockExec({ exit: 0, stdout }) },
    );
    const lines = out.log_tail.split("\n");
    expect(lines.length).toBe(10);
  });
});

describe("runQuality — failure flags (edge 19, edge 3)", () => {
  it("propagates oom flag when stderr matches OutOfMemoryError", async () => {
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/x", kind: "heavy" },
      {
        exec: mockExec({
          exit: 137,
          stderr: "java.lang.OutOfMemoryError: Java heap space",
          oom: true,
        }),
      },
    );
    expect(out.exit).toBe(137);
    expect(out.oom).toBe(true);
  });

  it("propagates timed_out flag", async () => {
    const out = await runQuality(
      {
        profile: javaSpringProfile,
        cwd: "/tmp/x",
        kind: "heavy",
        timeoutMs: 1000,
      },
      { exec: mockExec({ exit: 124, timed_out: true }) },
    );
    expect(out.timed_out).toBe(true);
  });

  it("non-zero exit surfaces unchanged for caller fix-loop dispatch", async () => {
    const out = await runQuality(
      { profile: javaSpringProfile, cwd: "/tmp/x", kind: "fast" },
      { exec: mockExec({ exit: 1, stderr: "FAIL: NPE at A.java:42" }) },
    );
    expect(out.exit).toBe(1);
    expect(out.oom).toBe(false);
    expect(out.timed_out).toBe(false);
    expect(out.log_tail).toMatch(/NPE at A.java:42/);
  });
});
