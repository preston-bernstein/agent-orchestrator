import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteJson, readJson } from "../../src/runs/state.js";

const tmp = path.join(process.cwd(), "runs", "_test_state");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("atomicWriteJson", () => {
  it("creates parent dir + writes target file", async () => {
    const target = path.join(tmp, "deep", "state.json");
    atomicWriteJson({ path: target, data: { a: 1 } });
    const got = readJson<{ a: number }>(target);
    expect(got.a).toBe(1);
  });

  it("removes tmp sibling after rename (no leftover .tmp files)", async () => {
    const target = path.join(tmp, "state.json");
    atomicWriteJson({ path: target, data: { a: 1 } });
    atomicWriteJson({ path: target, data: { a: 2 } });
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toHaveLength(0);
    expect(entries).toContain("state.json");
  });

  it("second write replaces target atomically (final value visible)", async () => {
    const target = path.join(tmp, "state.json");
    atomicWriteJson({ path: target, data: { v: "first" } });
    atomicWriteJson({ path: target, data: { v: "second" } });
    const got = readJson<{ v: string }>(target);
    expect(got.v).toBe("second");
  });

  it("pretty-prints (2-space indent) for human inspection", async () => {
    const target = path.join(tmp, "state.json");
    atomicWriteJson({ path: target, data: { a: 1, b: { c: 2 } } });
    const raw = await readFile(target, "utf8");
    expect(raw).toMatch(/\n {2}"a": 1/);
  });

  it("never leaves a partially-written target on collision w/ existing file", async () => {
    await mkdir(tmp, { recursive: true });
    const target = path.join(tmp, "state.json");
    await writeFile(target, '{"old":true}', "utf8");
    atomicWriteJson({ path: target, data: { fresh: true } });
    const got = readJson<{ fresh: boolean }>(target);
    expect(got.fresh).toBe(true);
    const st = await stat(target);
    expect(st.isFile()).toBe(true);
  });
});
