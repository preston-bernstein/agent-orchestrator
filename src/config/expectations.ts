import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const frontMatterSchema = z.object({
  vault_git_sha: z.string().optional(),
  vault_cut_date: z.string().optional(),
  playbook_path: z.string().optional(),
});

function splitFrontMatter(raw: string): { yaml: string; body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { yaml: "", body: raw };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) {
    return { yaml: "", body: raw };
  }
  return {
    yaml: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

interface SimpleYamlCtx {
  out: Record<string, unknown>;
  playbook: Record<string, string>;
  inPlaybook: boolean;
}

function stripYamlQuotes(val: string): string {
  return val.replace(/^["']|["']$/g, "");
}

function applySimpleYamlTopKey(top: RegExpExecArray, ctx: SimpleYamlCtx): void {
  ctx.inPlaybook = false;
  const k = top[1] as string;
  const val = top[2] ?? "";
  ctx.out[k] = stripYamlQuotes(val);
}

function tryParseSimpleYamlTopLine(line: string, ctx: SimpleYamlCtx): boolean {
  const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
  if (!top || top[1] === "PLAYBOOK_EXPECTS") return false;
  applySimpleYamlTopKey(top, ctx);
  return true;
}

function tryEnterPlaybookBlock(line: string, ctx: SimpleYamlCtx): boolean {
  if (line.trim() !== "PLAYBOOK_EXPECTS:") return false;
  ctx.inPlaybook = true;
  return true;
}

function tryAppendPlaybookIndented(line: string, ctx: SimpleYamlCtx): void {
  const ind = /^ {2}([a-z0-9_]+):\s*(.*)$/i.exec(line);
  if (!ind?.[1]) return;
  ctx.playbook[ind[1]] = stripYamlQuotes(ind[2] ?? "");
}

function parseSimpleYamlLine(line: string, ctx: SimpleYamlCtx): void {
  if (tryParseSimpleYamlTopLine(line, ctx)) return;
  if (tryEnterPlaybookBlock(line, ctx)) return;
  if (!ctx.inPlaybook) return;
  tryAppendPlaybookIndented(line, ctx);
}

/** Minimal YAML: top-level `key: value` + `PLAYBOOK_EXPECTS` indented block. */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const ctx: SimpleYamlCtx = {
    out: {},
    playbook: {},
    inPlaybook: false,
  };
  for (const line of yaml.split(/\r?\n/)) {
    parseSimpleYamlLine(line, ctx);
  }
  if (Object.keys(ctx.playbook).length > 0) {
    ctx.out.PLAYBOOK_EXPECTS = ctx.playbook;
  }
  return ctx.out;
}

export const ExpectationsSnapshotSchema = z.object({
  docPath: z.string(),
  docSha256: z.string(),
  vault_git_sha: z.string().optional(),
  vault_cut_date: z.string().optional(),
  playbook_path: z.string().optional(),
});
export type ExpectationsSnapshot = z.infer<typeof ExpectationsSnapshotSchema>;

async function readPlaybookExpectationsDoc(
  repoRoot: string,
  warnings: string[],
): Promise<{ docPath: string; raw: string } | null> {
  const docPath = path.join(repoRoot, "docs", "playbook-expectations.md");
  try {
    const raw = await readFile(docPath, "utf8");
    return { docPath, raw };
  } catch {
    warnings.push(`missing ${path.relative(repoRoot, docPath)} — copy from vault RepoKit template`);
    return null;
  }
}

function expectationsSnapshotFromFm(
  docPath: string,
  docSha256: string,
  fm: z.infer<typeof frontMatterSchema>,
): ExpectationsSnapshot {
  return {
    docPath,
    docSha256,
    vault_git_sha: fm.vault_git_sha?.trim() || undefined,
    vault_cut_date: fm.vault_cut_date?.trim() || undefined,
    playbook_path: fm.playbook_path?.trim() || undefined,
  };
}

function vaultCutWarnings(snapshot: ExpectationsSnapshot): string[] {
  if (snapshot.vault_git_sha || snapshot.vault_cut_date) return [];
  return ["vault_git_sha / vault_cut_date empty — fill after vault snapshot"];
}

function snapshotFromPlaybookDoc(
  docPath: string,
  raw: string,
): { snapshot: ExpectationsSnapshot; warnings: string[] } {
  const { yaml } = splitFrontMatter(raw);
  const docSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  const yamlObj = yaml.trim() ? parseSimpleYaml(yaml) : {};
  const merged = frontMatterSchema.safeParse(yamlObj);
  const fm = merged.success ? merged.data : {};
  const snapshot = expectationsSnapshotFromFm(docPath, docSha256, fm);
  return { snapshot, warnings: vaultCutWarnings(snapshot) };
}

export async function loadExpectations(
  repoRoot: string,
): Promise<{ snapshot: ExpectationsSnapshot; warnings: string[] }> {
  const warnings: string[] = [];
  const doc = await readPlaybookExpectationsDoc(repoRoot, warnings);
  if (!doc) {
    const docPath = path.join(repoRoot, "docs", "playbook-expectations.md");
    return { snapshot: { docPath, docSha256: "" }, warnings };
  }
  const built = snapshotFromPlaybookDoc(doc.docPath, doc.raw);
  return { snapshot: built.snapshot, warnings: warnings.concat(built.warnings) };
}

function throwIfStrictMissingDocSha(strict: boolean): void {
  if (!strict) return;
  throw new Error(
    "STRICT_EXPECTATIONS: EXPECTED_VAULT_SHA set but playbook-expectations.md has no vault_git_sha",
  );
}

function throwIfStrictShaMismatch(docSha: string, expectedFromEnv: string, strict: boolean): void {
  if (docSha === expectedFromEnv) return;
  if (!strict) return;
  throw new Error(`vault sha mismatch: doc=${docSha} env=${expectedFromEnv}`);
}

export function assertVaultShaAllowed(
  snapshot: ExpectationsSnapshot,
  expectedFromEnv: string | undefined,
  strict: boolean,
): void {
  if (!expectedFromEnv) return;
  if (!snapshot.vault_git_sha) {
    throwIfStrictMissingDocSha(strict);
    return;
  }
  throwIfStrictShaMismatch(snapshot.vault_git_sha, expectedFromEnv, strict);
}
