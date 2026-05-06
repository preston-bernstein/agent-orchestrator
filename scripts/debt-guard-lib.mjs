import fs from "node:fs";
import path from "node:path";

const LINE_COMMENT_SUPPRESS =
  /^\s*\/\/[^\n]*\b(?:eslint-disable(?:-next-line|-line)?|@ts-expect-error|@ts-ignore)\b/;
const BLOCK_LINE_SUPPRESS =
  /^\s*\/\*[\s\S]*?\b(?:eslint-disable(?:-next-line|-line)?|@ts-expect-error|@ts-ignore)\b[\s\S]*?\*\/\s*$/;

const SCANNABLE_EXT = new Set([".ts", ".mjs", ".cjs", ".js"]);
const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "runs",
  "coverage",
  "dist",
  ".stryker-tmp-t0",
  ".stryker-tmp-wide",
  "reports",
  "coverage-istanbul",
]);

/** @param {string} line */
function lineHasExcuse(line) {
  if (/\bORCH-\d+\b/i.test(line)) return true;
  if (/\bGH-\d+\b/i.test(line)) return true;
  if (/remove-by\s+\d{4}-\d{2}/i.test(line)) return true;
  if (/\/issues\/\d+/.test(line)) return true;
  if (/\b(?:TODO|FIXME|XXX)\s*\(\s*#?\d+/i.test(line)) return true;
  if (/\b(?:TODO|FIXME)\s+#\d+/i.test(line)) return true;
  return false;
}

/**
 * @param {string[]} lines
 * @param {number} i
 */
function hasNearbyExcuse(lines, i) {
  const line = lines[i];
  if (!line) return false;
  if (lineHasExcuse(line)) return true;
  let seenNonEmpty = 0;
  for (let j = i + 1; j < lines.length && seenNonEmpty < 3; j++) {
    const t = lines[j].trim();
    if (!t) continue;
    seenNonEmpty += 1;
    if (lineHasExcuse(lines[j])) return true;
  }
  return false;
}

/**
 * @param {string} relPath
 * @param {string} absPath
 * @param {Array<{ path: string; line: number; message: string }>} violations
 */
function scanFile(relPath, absPath, violations) {
  const raw = fs.readFileSync(absPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (LINE_COMMENT_SUPPRESS.test(line) || BLOCK_LINE_SUPPRESS.test(line)) {
      if (!hasNearbyExcuse(lines, i)) {
        violations.push({
          path: relPath,
          line: i + 1,
          message:
            "suppression requires nearby excuse (e.g. TODO(#123), ORCH-1, GH-42, remove-by YYYY-MM)",
        });
      }
    }
  }
}

/**
 * @param {string} absDir
 * @param {string} relative
 * @param {Array<{ path: string; line: number; message: string }>} violations
 */
function walk(absDir, relative, violations) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = path.join(relative, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      walk(path.join(absDir, ent.name), rel, violations);
      continue;
    }
    if (!SCANNABLE_EXT.has(path.extname(ent.name))) continue;
    scanFile(rel, path.join(absDir, ent.name), violations);
  }
}

/** @param {string} root */
export function runDebtGuard(root) {
  /** @type {Array<{ path: string; line: number; message: string }>} */
  const violations = [];
  walk(path.join(root, "src"), "src", violations);
  walk(path.join(root, "tests"), "tests", violations);
  walk(path.join(root, "scripts"), "scripts", violations);
  walk(path.join(root, "eslint"), "eslint", violations);
  return violations;
}
