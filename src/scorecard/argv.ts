import path from "node:path";
import { loadBootConfig } from "../config/env.js";

export type CliFormat = "default" | "json";

interface ParsedState {
  format: CliFormat;
  since?: string;
  runIds?: string[];
  runsDir: string;
}

function readFormat(argv: readonly string[], i: number): { next: number } {
  const v = argv[i + 1];
  if (v !== "json") {
    throw new Error("--format accepts only json (stdout only)");
  }
  return { next: i + 2 };
}

function readSince(argv: readonly string[], i: number): { since: string; next: number } {
  const v = argv[i + 1];
  if (!v) throw new Error("--since requires YYYY-MM-DD");
  return { since: v, next: i + 2 };
}

function readRuns(argv: readonly string[], i: number): { runIds: string[]; next: number } {
  const v = argv[i + 1];
  if (!v) throw new Error("--runs requires comma-separated ids");
  return {
    runIds: v.split(",").map((s) => s.trim()).filter(Boolean),
    next: i + 2,
  };
}

function readRunsDir(argv: readonly string[], i: number): {
  runsDir: string;
  next: number;
} {
  const v = argv[i + 1];
  if (!v) throw new Error("--runs-dir requires a path");
  return { runsDir: path.resolve(v), next: i + 2 };
}

export function parseScorecardArgv(argv: readonly string[]): {
  format: CliFormat;
  since?: string;
  runIds?: string[];
  runsDir: string;
} {
  const cfg = loadBootConfig();
  const state: ParsedState = {
    format: "default",
    runsDir: path.resolve(cfg.RUNS_DIR),
  };

  let i = 2;
  while (i < argv.length) {
    const a = argv[i] as string;

    if (a === "--format") {
      const r = readFormat(argv, i);
      state.format = "json";
      i = r.next;
      continue;
    }
    if (a === "--since") {
      const r = readSince(argv, i);
      state.since = r.since;
      i = r.next;
      continue;
    }
    if (a === "--runs") {
      const r = readRuns(argv, i);
      state.runIds = r.runIds;
      i = r.next;
      continue;
    }
    if (a === "--runs-dir") {
      const r = readRunsDir(argv, i);
      state.runsDir = r.runsDir;
      i = r.next;
      continue;
    }
    if (a === "--help" || a === "-h") {
      throw new Error("help");
    }
    i += 1;
  }

  return state;
}
