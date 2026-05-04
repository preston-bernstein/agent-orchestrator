import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBootConfig } from "../config/env.js";
import {
  buildScorecardModel,
  discoverAuditPaths,
  filterRunsSince,
  sinceIsoUtc,
  accumulateTotals,
  type ScorecardModel,
} from "./aggregate.js";
import { renderScorecardJson, renderScorecardMarkdown } from "./format.js";

export type CliFormat = "default" | "json";

export function parseScorecardArgv(argv: readonly string[]): {
  format: CliFormat;
  since?: string;
  runIds?: string[];
  runsDir: string;
} {
  let format: CliFormat = "default";
  let since: string | undefined;
  let runIds: string[] | undefined;
  const cfg = loadBootConfig();
  let runsDir = path.resolve(cfg.RUNS_DIR);

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--format") {
      const v = argv[++i];
      if (v !== "json") {
        throw new Error("--format accepts only json (stdout only)");
      }
      format = "json";
      continue;
    }
    if (a === "--since") {
      const v = argv[++i];
      if (!v) throw new Error("--since requires YYYY-MM-DD");
      since = v;
      continue;
    }
    if (a === "--runs") {
      const v = argv[++i];
      if (!v) throw new Error("--runs requires comma-separated ids");
      runIds = v.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === "--runs-dir") {
      const v = argv[++i];
      if (!v) throw new Error("--runs-dir requires a path");
      runsDir = path.resolve(v);
      continue;
    }
    if (a === "--help" || a === "-h") {
      throw new Error("help");
    }
  }

  return { format, since, runIds, runsDir };
}

function pathsForRunIds(runsDir: string, ids: string[]): string[] {
  return ids.map((id) => path.join(runsDir, id, "audit.jsonl"));
}

function helpText(): string {
  return `usage: pnpm run scorecard -- [options]

Options:
  --runs-dir <path>   directory containing run folders (default: RUNS_DIR / ./runs)
  --since YYYY-MM-DD  include runs whose last audit timestamp >= UTC midnight that day
  --runs id,id        only these run ids (folders under runs dir)
  --format json       print JSON to stdout only (no files)
  -h, --help          this message
`;
}

function recomputeTotals(model: ScorecardModel): ScorecardModel {
  return {
    ...model,
    totals: accumulateTotals(model.runs),
  };
}

export function runScorecardCli(argv: readonly string[]): number {
  let opts: ReturnType<typeof parseScorecardArgv>;
  try {
    opts = parseScorecardArgv(argv);
  } catch (e) {
    if (e instanceof Error && e.message === "help") {
      console.log(helpText());
      return 0;
    }
    console.error(e instanceof Error ? e.message : String(e));
    console.error(helpText());
    return 2;
  }

  let auditPaths: string[] | undefined;
  if (opts.runIds?.length) {
    auditPaths = pathsForRunIds(opts.runsDir, opts.runIds);
  } else {
    auditPaths = discoverAuditPaths(opts.runsDir);
  }

  let model = buildScorecardModel(opts.runsDir, auditPaths);
  if (opts.since) {
    const iso = sinceIsoUtc(opts.since);
    model = recomputeTotals({
      ...model,
      runs: filterRunsSince(model.runs, iso),
    });
  }

  if (opts.format === "json") {
    process.stdout.write(renderScorecardJson(model));
    return 0;
  }

  const outDir = opts.runsDir;
  mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "scorecard.md");
  const jsonPath = path.join(outDir, "scorecard.json");
  writeFileSync(mdPath, renderScorecardMarkdown(model), "utf8");
  writeFileSync(jsonPath, renderScorecardJson(model), "utf8");
  console.log(`wrote ${mdPath}`);
  console.log(`wrote ${jsonPath}`);
  return 0;
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exit(runScorecardCli(process.argv));
}
