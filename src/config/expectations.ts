import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { splitFrontMatter, parseSimpleYaml } from "./expectationsYaml.js";
import { frontMatterSchema, type ExpectationsSnapshot } from "./expectationsSnapshot.schema.js";

export {
  ExpectationsSnapshotSchema,
  type ExpectationsSnapshot,
} from "./expectationsSnapshot.schema.js";
export { assertVaultShaAllowed } from "./expectationsStrict.js";

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
