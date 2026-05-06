import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertVaultShaAllowed,
  loadExpectations,
} from "../src/config/expectations.js";

const tmp = path.join(process.cwd(), "runs", "_test_expectations");

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("loadExpectations", () => {
  it("warns when file missing", async () => {
    const { warnings, snapshot } = await loadExpectations(tmp);
    expect(warnings.length).toBeGreaterThan(0);
    expect(snapshot.docSha256).toBe("");
  });

  it("parses vault_git_sha from frontmatter", async () => {
    await mkdir(path.join(tmp, "docs"), { recursive: true });
    const doc = `---
vault_git_sha: "abc1234"
vault_cut_date: "2026-05-10"
---
# test
`;
    await writeFile(path.join(tmp, "docs", "playbook-expectations.md"), doc, "utf8");
    const { snapshot, warnings } = await loadExpectations(tmp);
    expect(snapshot.vault_git_sha).toBe("abc1234");
    expect(warnings.some((w) => w.includes("empty"))).toBe(false);
    expect(snapshot.docSha256.length).toBe(64);
  });

  it("parses PLAYBOOK_EXPECTS indented block in frontmatter", async () => {
    await mkdir(path.join(tmp, "docs"), { recursive: true });
    const doc = `---
vault_git_sha: "abc1234"
PLAYBOOK_EXPECTS:
  smoke_ok: "yes"
---
# test
`;
    await writeFile(path.join(tmp, "docs", "playbook-expectations.md"), doc, "utf8");
    const { snapshot } = await loadExpectations(tmp);
    expect(snapshot.vault_git_sha).toBe("abc1234");
    expect(snapshot.docSha256.length).toBe(64);
  });

  it("loads doc without YAML fences (full body as markdown)", async () => {
    await mkdir(path.join(tmp, "docs"), { recursive: true });
    const doc = `# Title only\nno --- fences\n`;
    await writeFile(path.join(tmp, "docs", "playbook-expectations.md"), doc, "utf8");
    const { snapshot, warnings } = await loadExpectations(tmp);
    expect(snapshot.docSha256.length).toBe(64);
    expect(warnings.some((w) => /vault_git_sha.*empty/i.test(w))).toBe(true);
  });

  it("treats unclosed --- fence as no frontmatter yaml", async () => {
    await mkdir(path.join(tmp, "docs"), { recursive: true });
    const doc = `---
vault_git_sha: "ghost"
still open, no closing delimiter
`;
    await writeFile(path.join(tmp, "docs", "playbook-expectations.md"), doc, "utf8");
    const { snapshot } = await loadExpectations(tmp);
    expect(snapshot.vault_git_sha).toBeUndefined();
    expect(snapshot.docSha256.length).toBe(64);
  });
});

describe("assertVaultShaAllowed", () => {
  it("throws when strict and mismatch", () => {
    expect(() =>
      assertVaultShaAllowed(
        { docPath: "x", docSha256: "0", vault_git_sha: "aaa" },
        "bbb",
        true,
      ),
    ).toThrow(/mismatch/);
  });

  it("throws when strict and env sha set but snapshot has no vault_git_sha", () => {
    expect(() =>
      assertVaultShaAllowed(
        { docPath: "x", docSha256: "0" },
        "bbb",
        true,
      ),
    ).toThrow(/STRICT_EXPECTATIONS/);
  });

  it("does not throw when env sha set but snapshot missing vault_git_sha and not strict", () => {
    expect(() =>
      assertVaultShaAllowed({ docPath: "x", docSha256: "0" }, "bbb", false),
    ).not.toThrow();
  });
});
