import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditWriter, ZERO_HASH } from "../../src/audit/jsonl.js";
import { verifyChain } from "../../src/audit/verify.js";

const tmp = path.join(process.cwd(), "runs", "_test_chain");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("AuditWriter + verifyChain", () => {
  it("writes 3 chained records; first prev_hash = ZERO; verifyChain returns valid", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    const r1 = w.write({
      run_id: "r1",
      step: "boot",
      agent: "system",
      timestamp: "2026-05-04T08:00:00Z",
    });
    const r2 = w.write({
      run_id: "r1",
      step: "planner",
      agent: "planner",
      tokens_in: 10,
      tokens_out: 20,
      timestamp: "2026-05-04T08:00:01Z",
    });
    const r3 = w.write({
      run_id: "r1",
      step: "gate",
      agent: "gate",
      cmd: ["pnpm", "test"],
      cwd: "/x",
      exit: 0,
      timestamp: "2026-05-04T08:00:02Z",
    });
    expect(r1.prev_hash).toBe(ZERO_HASH);
    expect(r2.prev_hash).toBe(r1.hash);
    expect(r3.prev_hash).toBe(r2.hash);

    const result = verifyChain(auditPath);
    expect(result).toEqual({ valid: true, count: 3 });
  });

  it("verifyChain returns brokenAt when middle record tampered", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    w.write({ run_id: "r1", step: "a", agent: "x", timestamp: "t1" });
    w.write({ run_id: "r1", step: "b", agent: "x", timestamp: "t2" });
    w.write({ run_id: "r1", step: "c", agent: "x", timestamp: "t3" });

    const raw = await readFile(auditPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const tampered = lines.slice();
    const mid = JSON.parse(tampered[1] as string) as Record<string, unknown>;
    mid.step = "b-tampered";
    tampered[1] = JSON.stringify(mid);
    await writeFile(auditPath, tampered.join("\n") + "\n", "utf8");

    const result = verifyChain(auditPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toMatch(/hash mismatch/);
    }
  });

  it("verifyChain detects deleted record via prev_hash mismatch", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    w.write({ run_id: "r1", step: "a", agent: "x", timestamp: "t1" });
    w.write({ run_id: "r1", step: "b", agent: "x", timestamp: "t2" });
    w.write({ run_id: "r1", step: "c", agent: "x", timestamp: "t3" });

    const raw = await readFile(auditPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const trimmed = [lines[0], lines[2]].join("\n") + "\n";
    await writeFile(auditPath, trimmed, "utf8");

    const result = verifyChain(auditPath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toMatch(/prev_hash mismatch/);
    }
  });

  it("empty file => valid w/ count 0", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    await writeFile(auditPath, "", "utf8");
    expect(verifyChain(auditPath)).toEqual({ valid: true, count: 0 });
  });
});
