#!/usr/bin/env node
/**
 * Fails CI if eslint/ts suppressions omit a tracked excuse (TODO(#n), GH-n, remove-by …).
 *
 * Matches only genuine line-start // block comments — string literals mentioning
 * eslint-disable (e.g. agent prompts) are ignored.
 *
 * Scope: src/, tests/, scripts/*.mjs, eslint/*.mjs (not JSON config files — JSON has no trailing comments).
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runDebtGuard } from "./debt-guard-lib.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function main() {
  const violations = runDebtGuard(root);

  if (violations.length === 0) {
    console.log("debt-guard: ok (no undocumented suppressions in scanned paths)");
    process.exit(0);
    return;
  }

  for (const v of violations) {
    console.error(`${v.path}:${v.line}: ${v.message}`);
  }
  console.error(`\ndebt-guard: ${violations.length} violation(s)`);
  process.exit(1);
}

main();
