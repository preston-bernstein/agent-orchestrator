/**
 * Isolated `vi.mock("node:fs")` — keeps mutation-focused stubs out of `state.test.ts`.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const a = await importOriginal<typeof import("node:fs")>();
  return {
    ...a,
    renameSync: vi.fn((...args: Parameters<typeof a.renameSync>) => a.renameSync(...args)),
    unlinkSync: vi.fn((...args: Parameters<typeof a.unlinkSync>) => a.unlinkSync(...args)),
    openSync: vi.fn((...args: Parameters<typeof a.openSync>) => a.openSync(...args)),
    writeSync: vi.fn((...args: Parameters<typeof a.writeSync>) => a.writeSync(...args)),
    closeSync: vi.fn((...args: Parameters<typeof a.closeSync>) => a.closeSync(...args)),
  };
});

import * as fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { atomicWriteJson } from "../../src/runs/state.js";

const tmp = path.join(process.cwd(), "runs", "_test_state_edge");

afterEach(async () => {
  vi.mocked(fs.renameSync).mockReset();
  vi.mocked(fs.unlinkSync).mockReset();
  vi.mocked(fs.openSync).mockReset();
  vi.mocked(fs.writeSync).mockReset();
  vi.mocked(fs.closeSync).mockReset();
  await rm(tmp, { recursive: true, force: true });
});

describe("atomicWriteJson edge (mutation guards)", () => {
  it("unlinks tmp and rethrows when renameSync fails", async () => {
    await mkdir(tmp, { recursive: true });
    const target = path.join(tmp, "rename_fail.json");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error("rename boom");
    });
    expect(() => atomicWriteJson({ path: target, data: { x: 1 } })).toThrow("rename boom");
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it("closes fd when writeSync throws (fsync path)", async () => {
    await mkdir(tmp, { recursive: true });
    const target = path.join(tmp, "write_fail.json");
    const fakeFd = 42;
    vi.mocked(fs.openSync).mockImplementationOnce(() => fakeFd as ReturnType<typeof fs.openSync>);
    vi.mocked(fs.writeSync).mockImplementationOnce(() => {
      throw new Error("write boom");
    });
    expect(() => atomicWriteJson({ path: target, data: { x: 1 }, fsync: true })).toThrow("write boom");
    expect(fs.closeSync).toHaveBeenCalledWith(fakeFd);
  });
});
