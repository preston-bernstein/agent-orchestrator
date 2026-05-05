// I4 deliverable per [[Inngest Integration Plan]] §I4 + task 40.
//
// Asserts:
//   1. Cold call: cache miss → fetchFn invoked once → response cached.
//   2. Replay (same runId+agentName+promptHash) → cache hit → fetchFn NOT invoked again.
//   3. Different promptHash (e.g. retry w/ mutated input) = miss = real fetch (proves
//      we're not just always-hitting on runId).
//   4. idempotencyKey() produces stable string for stable inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TfCache, hashPrompt, idempotencyKey, tfCall } from "../../src/tf/cache.js";

let tmpDir: string;
let cache: TfCache;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tf-cache-"));
  cache = new TfCache(join(tmpDir, "tf.db"));
});

afterEach(() => {
  cache.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("TfCache — replay safety (I4 task 40)", () => {
  it("cold call invokes fetch once + caches response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ choice: "ok" });
    const res = await tfCall(cache, { runId: "run-A" }, "planner", '{"p":"hi"}', fetchFn);
    expect(res).toEqual({ choice: "ok" });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const promptHash = hashPrompt('{"p":"hi"}');
    expect(cache.get({ runId: "run-A", agentName: "planner", promptHash })?.response).toEqual({
      choice: "ok",
    });
  });

  it("REPLAY: same (runId,agent,promptHash) returns cached + DOES NOT invoke fetch", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ choice: "first-only" });

    // First call — populates cache.
    const a = await tfCall(cache, { runId: "run-B" }, "planner", '{"p":"hi"}', fetchFn);
    // Second call — must hit cache, fetchFn must remain at 1.
    const b = await tfCall(cache, { runId: "run-B" }, "planner", '{"p":"hi"}', fetchFn);
    // Third call — same again.
    const c = await tfCall(cache, { runId: "run-B" }, "planner", '{"p":"hi"}', fetchFn);

    expect(a).toEqual({ choice: "first-only" });
    expect(b).toEqual({ choice: "first-only" });
    expect(c).toEqual({ choice: "first-only" });
    expect(fetchFn).toHaveBeenCalledTimes(1); // critical: zero second TF network call
  });

  it("different promptHash on same runId = miss = real fetch (no false cache reuse)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ choice: "A" })
      .mockResolvedValueOnce({ choice: "B" });

    const a = await tfCall(cache, { runId: "run-C" }, "planner", '{"p":"hi"}', fetchFn);
    const b = await tfCall(cache, { runId: "run-C" }, "planner", '{"p":"bye"}', fetchFn);

    expect(a).toEqual({ choice: "A" });
    expect(b).toEqual({ choice: "B" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("different runId on same prompt = miss (cache is per-run, not global)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ choice: "run1" })
      .mockResolvedValueOnce({ choice: "run2" });

    await tfCall(cache, { runId: "run-D-1" }, "planner", '{"p":"hi"}', fetchFn);
    await tfCall(cache, { runId: "run-D-2" }, "planner", '{"p":"hi"}', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("idempotencyKey() is stable for stable inputs", () => {
    const k1 = idempotencyKey({ runId: "r", agentName: "a", promptHash: "h" });
    const k2 = idempotencyKey({ runId: "r", agentName: "a", promptHash: "h" });
    expect(k1).toBe(k2);
    expect(k1).toBe("r:a:h");
  });
});
