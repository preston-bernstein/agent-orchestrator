#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowlistPath = path.join(root, "docs", "architecture", "allowlist.json");

const utilsGlobRoots = ["src"];

/** @type {string[]} */
const violations = [];
const allowlist = loadAllowlist();

function loadAllowlist() {
  try {
    const raw = fs.readFileSync(allowlistPath, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.exported_types_outside_types)
      ? parsed.exported_types_outside_types
      : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function isTypeDefinitionFile(rel) {
  return (
    rel.endsWith("/types.ts") ||
    rel.endsWith("/schema.ts") ||
    rel.endsWith(".schema.ts")
  );
}

function checkTypePlacement(rel) {
  if (isTypeDefinitionFile(rel)) return;
  const raw = read(rel);
  const hasInterfaceDecl = /\bexport\s+interface\s+[A-Z]\w*/.test(raw);
  const hasNamedTypeAlias = /\bexport\s+type\s+[A-Z]\w*\s*=/.test(raw);
  if (hasInterfaceDecl || hasNamedTypeAlias) {
    if (allowlist.has(rel)) return;
    violations.push(
      `${rel}: exported/shared interfaces/types must live in local types.ts`,
    );
  }
}

function walk(absDir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith(".ts")) continue;
    out.push(abs);
  }
}

function checkUtilsPurity() {
  /** @type {string[]} */
  const files = [];
  for (const rel of utilsGlobRoots) {
    walk(path.join(root, rel), files);
  }
  for (const abs of files) {
    if (!abs.includes(`${path.sep}utils${path.sep}`)) continue;
    const rel = path.relative(root, abs);
    const raw = fs.readFileSync(abs, "utf8");
    if (/from\s+["'].*\/adapters\/.*["']/.test(raw)) {
      violations.push(`${rel}: utils must not import from adapters`);
    }
  }
}

/** @type {string[]} */
const srcFiles = [];
walk(path.join(root, "src"), srcFiles);
for (const abs of srcFiles) {
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  checkTypePlacement(rel);
}
checkUtilsPurity();

if (violations.length === 0) {
  console.log("architecture-guard: ok");
  process.exit(0);
}

for (const v of violations) {
  console.error(v);
}
console.error(`\narchitecture-guard: ${violations.length} violation(s)`);
process.exit(1);
