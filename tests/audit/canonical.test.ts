import { describe, expect, it } from "vitest";
import { canonicalize, hashRecord } from "../../src/audit/jsonl.js";

describe("canonicalize", () => {
  it("sorts object keys at every level", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"z":{"x":2,"y":1}}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined keys (so callers can pass {hash: undefined})", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("emits null for top-level undefined (defensive)", () => {
    expect(canonicalize(undefined)).toBe("null");
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: 1, b: { c: 2 } })).not.toMatch(/\s/);
  });
});

describe("hashRecord — key-order independence", () => {
  it("identical hash regardless of object key insertion order", () => {
    const a = {
      run_id: "r1",
      step: "boot",
      agent: "system",
      timestamp: "t1",
      prev_hash: "0".repeat(64),
    };
    const b = {
      timestamp: "t1",
      step: "boot",
      prev_hash: "0".repeat(64),
      agent: "system",
      run_id: "r1",
    };
    expect(hashRecord(a)).toBe(hashRecord(b));
  });

  it("different content => different hash", () => {
    const a = {
      run_id: "r1",
      step: "boot",
      agent: "system",
      timestamp: "t1",
      prev_hash: "0".repeat(64),
    };
    const b = { ...a, step: "planner" };
    expect(hashRecord(a)).not.toBe(hashRecord(b));
  });
});
