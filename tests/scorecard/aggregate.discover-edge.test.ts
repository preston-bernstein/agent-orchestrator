/** Isolated `vi.mock("node:fs")` for discoverAuditPaths + statSync error path. */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const a = await importOriginal<typeof import("node:fs")>();
  return {
    ...a,
    statSync: vi.fn((...args: Parameters<typeof a.statSync>) => a.statSync(...args)),
  };
});

import * as fs from "node:fs";
import { discoverAuditPaths } from "../../src/scorecard/aggregate.js";

const root = path.join(process.cwd(), "runs", "_scorecard_discover_edge");

afterEach(async () => {
  vi.mocked(fs.statSync).mockReset();
  await rm(root, { recursive: true, force: true });
});

describe("discoverAuditPaths edge", () => {
  it("skips entries where statSync throws", async () => {
    await mkdir(path.join(root, "badrun"), { recursive: true });
    await writeFile(path.join(root, "badrun", "audit.jsonl"), "", "utf8");
    const badDir = path.join(root, "badrun");
    const { statSync: realStat } = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.statSync).mockImplementation((p, opts) => {
      if (path.resolve(String(p)) === path.resolve(badDir)) throw new Error("stat boom");
      return realStat(p, opts as never);
    });
    expect(discoverAuditPaths(root)).toEqual([]);
  });
});
