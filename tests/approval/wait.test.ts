import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { waitForApprovalDecision, writeApprovalDecision } from "../../src/approval/wait.js";

const tmp = path.join(process.cwd(), "runs", "_test_wait");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function seedPayload(runId: string, supervisor: string): void {
  const dir = path.join(tmp, runId, supervisor);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "approval-payload.json"),
    JSON.stringify({
      run_id: runId,
      supervisor,
      diff_hash: "a".repeat(64),
    }),
  );
}

describe("approval/wait", () => {
  it("writes approve decision using payload diff hash", () => {
    seedPayload("run-1", "spring");
    const out = writeApprovalDecision({
      runId: "run-1",
      supervisor: "spring",
      approved: true,
      note: "looks good",
      runsDir: tmp,
    });
    expect(out.approved).toBe(true);
    expect(out.diff_hash).toHaveLength(64);
    const raw = readFileSync(path.join(tmp, "run-1", "spring", "approval-decision.json"), "utf8");
    expect(raw).toContain('"approved": true');
  });

  it("waitForApprovalDecision resolves null on timeout", async () => {
    const out = await waitForApprovalDecision({
      runId: "run-miss",
      supervisor: "spring",
      runsDir: tmp,
      timeoutMs: 10,
      pollMs: 5,
    });
    expect(out).toBeNull();
  });
});

