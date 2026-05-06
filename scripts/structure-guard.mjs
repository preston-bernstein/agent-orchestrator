#!/usr/bin/env node
/**
 * Deterministic file-family layout guard.
 *
 * Rule:
 * - If a directory contains `foo.ts` and `fooBar.ts`, that family must be grouped.
 * - `fooBar.ts` should live under `foo/` (for example: `foo/bar.ts`).
 *
 * This keeps related files colocated and prevents flat-folder drift.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runStructureGuard } from "./structure-guard-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scanRoots = ["src", "tests", "scripts"];

/**
 * @typedef {{ file: string; base: string; family: string; dir: string }} FamilyViolation
 * @typedef {{ file: string; folder: string; family: string; dir: string }} FolderLeafViolation
 * @typedef {{ file: string; base: string; suffix: string; dir: string }} DottedFamilyViolation
 */

/** @type {Array<FamilyViolation | FolderLeafViolation | DottedFamilyViolation>} */
const violations = runStructureGuard(root, scanRoots);

if (violations.length === 0) {
  console.log("structure-guard: ok (file families are grouped)");
  process.exit(0);
}

for (const v of violations) {
  if ("base" in v) {
    if ("suffix" in v) {
      const target = `${v.dir}/${v.base}/${v.suffix}.*`;
      console.error(
        `${v.file}: dotted family "${v.base}.${v.suffix}" should be grouped (move under ${target})`,
      );
      continue;
    }
    const suggestedLeaf = v.family.slice(v.base.length);
    const target = `${v.dir}/${v.base}/${suggestedLeaf[0]?.toLowerCase() ?? ""}${suggestedLeaf.slice(1)}.*`;
    console.error(
      `${v.file}: family "${v.base}" should be grouped (move under ${target})`,
    );
    continue;
  }
  const suggestedLeaf = v.family.slice(v.folder.length);
  const target = `${v.dir}/${suggestedLeaf[0]?.toLowerCase() ?? ""}${suggestedLeaf.slice(1)}.*`;
  console.error(
    `${v.file}: folder family "${v.folder}" must use leaf naming (move to ${target})`,
  );
}
console.error(`\nstructure-guard: ${violations.length} violation(s)`);
process.exit(1);
