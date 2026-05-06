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

function parseSimpleYamlLine(line: string, ctx: SimpleYamlCtx): void {
  const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
  if (top && top[1] !== "PLAYBOOK_EXPECTS") {
    ctx.inPlaybook = false;
    const k = top[1] as string;
    const val = top[2] ?? "";
    ctx.out[k] = val.replace(/^["']|["']$/g, "");
    return;
  }
  if (line.trim() === "PLAYBOOK_EXPECTS:") {
    ctx.inPlaybook = true;
    return;
  }
  if (!ctx.inPlaybook) return;
  const ind = /^ {2}([a-z0-9_]+):\s*(.*)$/i.exec(line);
  if (ind?.[1]) {
    ctx.playbook[ind[1]] = (ind[2] ?? "").replace(/^["']|["']$/g, "");
  }
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

export async function loadExpectations(
  repoRoot: string,
): Promise<{ snapshot: ExpectationsSnapshot; warnings: string[] }> {
  const warnings: string[] = [];
  const docPath = path.join(repoRoot, "docs", "playbook-expectations.md");
  let raw: string;
  try {
    raw = await readFile(docPath, "utf8");
  } catch {
    warnings.push(`missing ${path.relative(repoRoot, docPath)} — copy from vault RepoKit template`);
    return { snapshot: { docPath, docSha256: "" }, warnings };
  }
  const { yaml } = splitFrontMatter(raw);
  const docSha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  const yamlObj = yaml.trim() ? parseSimpleYaml(yaml) : {};
  const merged = frontMatterSchema.safeParse(yamlObj);
  const fm = merged.success ? merged.data : {};
  const snapshot: ExpectationsSnapshot = {
    docPath,
    docSha256,
    vault_git_sha: fm.vault_git_sha?.trim() || undefined,
    vault_cut_date: fm.vault_cut_date?.trim() || undefined,
    playbook_path: fm.playbook_path?.trim() || undefined,
  };
  if (!snapshot.vault_git_sha && !snapshot.vault_cut_date) {
    warnings.push("vault_git_sha / vault_cut_date empty — fill after vault snapshot");
  }
  return { snapshot, warnings };
}

export function assertVaultShaAllowed(
  snapshot: ExpectationsSnapshot,
  expectedFromEnv: string | undefined,
  strict: boolean,
): void {
  if (!expectedFromEnv) return;
  if (!snapshot.vault_git_sha) {
    if (strict) {
      throw new Error(
        "STRICT_EXPECTATIONS: EXPECTED_VAULT_SHA set but playbook-expectations.md has no vault_git_sha",
      );
    }
    return;
  }
  if (snapshot.vault_git_sha !== expectedFromEnv) {
    const msg = `vault sha mismatch: doc=${snapshot.vault_git_sha} env=${expectedFromEnv}`;
    if (strict) throw new Error(msg);
  }
}
