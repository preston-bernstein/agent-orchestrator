import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuditWriter,
  RedactionFailure,
  ZERO_HASH,
  findLeak,
  redactString,
} from "../../src/audit/jsonl.js";

const tmp = path.join(process.cwd(), "runs", "_test_redaction");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("redactString", () => {
  it("scrubs literal secrets", () => {
    expect(redactString("token=SUPER_SECRET-XYZ here", ["SUPER_SECRET-XYZ"])).toBe(
      "token=[REDACTED] here",
    );
  });

  it("scrubs Bearer header pattern", () => {
    expect(redactString("Authorization: Bearer abc.123-foo")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("scrubs sk- API key shape", () => {
    expect(redactString("key=sk-abcdefghijklmnopqrstuv")).toBe("key=[REDACTED]");
  });

  it("multiple occurrences all scrubbed", () => {
    expect(
      redactString("a=Bearer xyz.1 b=Bearer abc.2", []),
    ).toBe("a=[REDACTED] b=[REDACTED]");
  });

  it("Bearer pattern uses \\s+ quantifier — multi-whitespace consumed", () => {
    // mutation guard: \s+ vs \s. Two tabs between "Bearer" and token must
    // still match + redact entirely (no token characters survive).
    expect(redactString("a=Bearer\t\tfoo.bar")).toBe("a=[REDACTED]");
  });

  it("skips empty-string literals (no string-mangling)", () => {
    // mutation guard: `if (!lit) continue` — without skip, s.split("") +
    // join("[REDACTED]") would shred every character.
    expect(redactString("hello", ["", "world"])).toBe("hello");
  });

  it("default literals param is empty (no built-in literal list)", () => {
    // mutation guard: default `[]` vs Stryker's `["Stryker was here"]`.
    expect(redactString("Stryker was here is fine")).toBe(
      "Stryker was here is fine",
    );
  });
});

describe("findLeak", () => {
  it("returns null on clean string", () => {
    expect(findLeak("hello world")).toBeNull();
  });

  it("flags a literal still present", () => {
    expect(findLeak("token=MY_SECRET tail", ["MY_SECRET"])).toMatch(/^literal:/);
  });

  it("flags a Bearer pattern still present", () => {
    expect(findLeak("Bearer raw.token-here")).toMatch(/^pattern:/);
  });

  it("literal descriptor truncates leak to first 4 chars + ellipsis", () => {
    // mutation guard: `lit.slice(0, 4)` vs full lit — assert exact prefix.
    expect(findLeak("x=ABCDEFGH y", ["ABCDEFGH"])).toBe("literal:ABCD…");
  });

  it("skips empty-string literals (so `\"\"` ⊆ s never reports leak)", () => {
    // mutation guard: `if (!lit) continue`. Without skip, s.includes("")
    // is always true ⇒ would falsely flag every clean string.
    expect(findLeak("clean", [""])).toBeNull();
  });

  it("default literals param is empty (no built-in literal list)", () => {
    // mutation guard: default `[]` vs Stryker's `["Stryker was here"]`.
    expect(findLeak("Stryker was here is fine")).toBeNull();
  });
});

describe("ZERO_HASH", () => {
  it("is exactly 64 zero characters (SHA-256 hex width)", () => {
    // mutation guard: `"0".repeat(64)` vs `"".repeat(64)`.
    expect(ZERO_HASH).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(ZERO_HASH.length).toBe(64);
  });
});

describe("RedactionFailure", () => {
  it("error message contains the leak descriptor + flag path", () => {
    // mutation guard: super(`redaction_failure: ${leak} (flag=${flagPath})`)
    // vs super(``).
    const err = new RedactionFailure("literal:ABCD…", "/tmp/x.flag");
    expect(err.message).toContain("redaction_failure");
    expect(err.message).toContain("literal:ABCD…");
    expect(err.message).toContain("/tmp/x.flag");
    expect(err.name).toBe("RedactionFailure");
  });
});

describe("AuditWriter redaction guard", () => {
  it("scrubs Bearer in record string fields; chain valid; flag NOT created", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    w.write({
      run_id: "r1",
      step: "boot",
      agent: "system",
      cmd: ["curl", "-H", "Authorization: Bearer abc.123-foo"],
      timestamp: "t1",
    });
    const raw = await readFile(auditPath, "utf8");
    expect(raw).not.toMatch(/Bearer abc\.123-foo/);
    expect(raw).toMatch(/\[REDACTED\]/);

    const flag = path.join(tmp, "redaction_failure.flag");
    await expect(stat(flag)).rejects.toThrow();
  });

  it("scrubs literal TF_API_KEY-like value when passed via secrets[]", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({
      path: auditPath,
      secrets: ["tf-key-XYZ-1234"],
    });
    w.write({
      run_id: "r1",
      step: "boot",
      agent: "system",
      cmd: ["echo", "tf-key-XYZ-1234"],
      timestamp: "t1",
    });
    const raw = await readFile(auditPath, "utf8");
    expect(raw).not.toMatch(/tf-key-XYZ-1234/);
    expect(raw).toMatch(/\[REDACTED\]/);
  });

  it("refuses + writes redaction_failure.flag when post-check finds an unredacted literal", async () => {
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    // scrub list empty, post-check list has a literal that the record contains
    // => post-scan flags leak; writer throws + writes flag.
    const w = new AuditWriter({
      path: auditPath,
      secrets: [],
      postCheckLiterals: ["LEAK_LITERAL"],
    });
    expect(() =>
      w.write({
        run_id: "r1",
        step: "boot",
        agent: "system",
        cmd: ["echo", "LEAK_LITERAL"],
        timestamp: "t1",
      }),
    ).toThrow(/redaction_failure/);

    const flagRaw = await readFile(path.join(tmp, "redaction_failure.flag"), "utf8");
    // mutation guard: `+ "\n"` flag terminator.
    expect(flagRaw.endsWith("\n")).toBe(true);
    const flagJson = JSON.parse(flagRaw) as { leak: string; run_id: string };
    expect(flagJson.leak).toMatch(/^literal:/);
    expect(flagJson.run_id).toBe("r1");

    // chain file should NOT contain the offending record
    const audit = await readFile(auditPath, "utf8").catch(() => "");
    expect(audit).toBe("");
  });

  it("default secrets list is empty (no built-in literal scrub set)", async () => {
    // mutation guard: `opts.secrets ?? []` vs `["Stryker was here"]`.
    await mkdir(tmp, { recursive: true });
    const auditPath = path.join(tmp, "audit.jsonl");
    const w = new AuditWriter({ path: auditPath });
    w.write({
      run_id: "r1",
      step: "boot",
      agent: "system",
      cmd: ["echo", "Stryker was here"],
      timestamp: "t1",
    });
    const raw = await readFile(auditPath, "utf8");
    expect(raw).toContain("Stryker was here");
    expect(raw).not.toContain("[REDACTED]");
  });
});
