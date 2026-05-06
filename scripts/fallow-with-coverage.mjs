#!/usr/bin/env node
/**
 * Runs fallow with Istanbul `coverage-final.json` so CRAP uses measured coverage
 * (`coverage_model: istanbul`). Requires `pnpm run coverage:istanbul` first.
 * Then runs jscpd against `.jscpd.json` (silent): duplicate **line %** ceiling on
 * **src/** + **scripts/** + **tests/**. Full listing: `pnpm run dup:jscpd`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coverageFinal = path.join(root, "coverage-istanbul", "coverage-final.json");

if (!existsSync(coverageFinal)) {
  console.error(
    "Missing coverage-istanbul/coverage-final.json — run `pnpm run coverage:istanbul` first (Istanbul output for Fallow CRAP).",
  );
  process.exit(1);
}

process.env.FALLOW_COVERAGE = coverageFinal;

const fallow = spawnSync("pnpm", ["exec", "fallow", "--format", "compact"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (fallow.status !== 0 || fallow.signal) {
  process.exit(fallow.status ?? 1);
}

const jscpd = spawnSync(
  "pnpm",
  ["exec", "jscpd", "--config", ".jscpd.json", "--silent", "src", "scripts", "tests"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(jscpd.status ?? 1);
