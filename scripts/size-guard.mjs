#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowlistPath = path.join(root, "docs", "architecture", "allowlist.json");
const targetLines = 120;
const scanRoots = ["src", "tests", "scripts"];
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

function readAllowlist() {
  try {
    const raw = fs.readFileSync(allowlistPath, "utf8");
    const parsed = JSON.parse(raw);
    const listed = Array.isArray(parsed.file_lines_over_120)
      ? parsed.file_lines_over_120
      : [];
    return new Set(listed);
  } catch {
    return new Set();
  }
}

const allowlist = readAllowlist();
/** @type {Array<{ file: string; lines: number }>} */
const violations = [];

function readDirEntries(absDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries;
}

function shouldScanFile(ent) {
  if (!ent.isFile()) return false;
  if (ent.name.endsWith(".d.ts")) return false;
  const ext = path.extname(ent.name);
  return exts.has(ext);
}

function recordViolation(abs) {
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(abs, "utf8").split("\n").length;
  if (lines <= targetLines) return;
  if (allowlist.has(rel)) return;
  violations.push({ file: rel, lines });
}

function walk(absDir) {
  const entries = readDirEntries(absDir);
  for (const ent of entries) {
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      walk(abs);
      continue;
    }
    if (!shouldScanFile(ent)) continue;
    recordViolation(abs);
  }
}

for (const scanRoot of scanRoots) {
  walk(path.join(root, scanRoot));
}

if (violations.length === 0) {
  console.log(`size-guard: ok (target <= ${targetLines} lines per file)`);
  process.exit(0);
}

violations.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
for (const v of violations) {
  console.error(`${v.file}: ${v.lines} lines (target <= ${targetLines})`);
}
console.error(`\nsize-guard: ${violations.length} violation(s)`);
process.exit(1);
