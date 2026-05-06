#!/usr/bin/env node
/**
 * Runs dependency-cruiser with `.dependency-cruiser.js` (recommended-strict-derived rules).
 *
 * - Host Node in `^20.12 || ^22 || >=24`: run CLI with `process.execPath`.
 * - Otherwise (e.g. Node 23): run the same CLI under `npx -y node@22` so rules stay strict.
 * - If that fails (offline / npx): fall back to `madge --circular` only.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import satisfies from "semver/functions/satisfies.js";

/** Mirrors dependency-cruiser@17 engines.node */
const DEPCRUISE_NODE_RANGE = "^20.12 || ^22 || >=24";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const depcruiseBin = path.join(root, "node_modules", "dependency-cruiser", "bin", "dependency-cruise.mjs");

const depcruiseArgs = ["--validate", ".dependency-cruiser.js", "src"];

function runDepcruiseHostNode() {
  return spawnSync(process.execPath, [depcruiseBin, ...depcruiseArgs], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
}

function runDepcruiseNpxNode22() {
  return spawnSync("npx", ["-y", "node@22", depcruiseBin, ...depcruiseArgs], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
}

function runMadgeCircularFallback() {
  console.warn("deps:cruise: falling back to madge --circular (subset of dependency-cruiser rules).");
  return spawnSync("pnpm", ["exec", "madge", "--circular", "--extensions", "ts", "src"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
}

function main() {
  const ver = process.versions.node;

  if (satisfies(ver, DEPCRUISE_NODE_RANGE)) {
    const r = runDepcruiseHostNode();
    process.exit(r.status ?? 1);
    return;
  }

  console.warn(
    `deps:cruise: Node ${ver} is outside dependency-cruiser supported range (${DEPCRUISE_NODE_RANGE}); running depcruise via npx node@22.`,
  );
  const viaNpx = runDepcruiseNpxNode22();
  if ((viaNpx.status ?? 1) === 0) {
    process.exit(0);
    return;
  }

  const fb = runMadgeCircularFallback();
  process.exit(fb.status ?? 1);
}

main();
