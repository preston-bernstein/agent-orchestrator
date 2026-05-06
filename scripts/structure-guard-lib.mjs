import fs from "node:fs";
import path from "node:path";

const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const skipDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "coverage-istanbul",
  "runs",
  "reports",
  ".stryker-tmp-t0",
  ".stryker-tmp-wide",
]);
const dottedSuffixes = new Set(["schema", "types"]);

function isFamilySibling(base, candidate) {
  if (candidate === base || !candidate.startsWith(base)) return false;
  const next = candidate[base.length];
  return typeof next === "string" && /[A-Z]/.test(next);
}

function isFolderPrefixedFamily(fileBase, folderName) {
  if (fileBase === folderName || !fileBase.startsWith(folderName)) return false;
  const next = fileBase[folderName.length];
  return typeof next === "string" && /[A-Z]/.test(next);
}

function readDirEntries(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isScannableSourceFile(name) {
  if (!exts.has(path.extname(name))) return false;
  return !name.endsWith(".d.ts");
}

function familyViolationsInDir(files, absDir, root, violations) {
  if (files.length < 2) return;
  for (const a of files) {
    for (const b of files) {
      if (!isFamilySibling(a.name, b.name)) continue;
      violations.push({
        file: path.relative(root, b.abs),
        base: a.name,
        family: b.name,
        dir: path.relative(root, absDir),
      });
    }
  }
}

function folderLeafViolationsInDir(files, absDir, root, violations) {
  const folderName = path.basename(absDir);
  for (const f of files) {
    if (!isFolderPrefixedFamily(f.name, folderName)) continue;
    violations.push({
      file: path.relative(root, f.abs),
      folder: folderName,
      family: f.name,
      dir: path.relative(root, absDir),
    });
  }
}

function dottedFamilyViolationsInDir(files, absDir, root, violations) {
  const byName = new Set(files.map((f) => f.name));
  for (const f of files) {
    const parts = f.name.split(".");
    if (parts.length !== 2) continue;
    const [base, suffix] = parts;
    if (!base || !dottedSuffixes.has(suffix) || !byName.has(base)) continue;
    violations.push({
      file: path.relative(root, f.abs),
      base,
      suffix,
      dir: path.relative(root, absDir),
    });
  }
}

function walk(absDir, root, violations) {
  const entries = readDirEntries(absDir);
  /** @type {Array<{ name: string; abs: string }>} */
  const files = [];
  for (const ent of entries) {
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      walk(abs, root, violations);
      continue;
    }
    if (!isScannableSourceFile(ent.name)) continue;
    files.push({ name: path.basename(ent.name, path.extname(ent.name)), abs });
  }
  familyViolationsInDir(files, absDir, root, violations);
  folderLeafViolationsInDir(files, absDir, root, violations);
  dottedFamilyViolationsInDir(files, absDir, root, violations);
}

export function runStructureGuard(root, scanRoots) {
  /** @type {Array<Record<string, string>>} */
  const violations = [];
  for (const rel of scanRoots) {
    walk(path.join(root, rel), root, violations);
  }
  return violations;
}
