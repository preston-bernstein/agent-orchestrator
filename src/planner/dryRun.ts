import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  plannerAttemptCounterClear,
  plannerReposWorktreesClean,
  plannerSpecsAllComplete,
} from "./dryRunChecks.js";
import type { PlannerDryRunInput } from "./types.js";

export type { PlannerDryRunInput, PlannerDryRunSpec } from "./types.js";

const execFileAsync = promisify(execFile);

interface PlannerDryRunResult {
  skip: boolean;
  reason: string;
}

/**
 * Parse GitHub-style task checkboxes from a markdown body. Returns lines
 * that *look* like task lines, with their done-state. Non-task lines are
 * ignored (per O5 §"Tasks.md checkbox parsing" — grep-style line scan, no
 * AST).
 */
export function parseCheckboxes(md: string): { done: boolean; line: string }[] {
  const out: { done: boolean; line: string }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*\[(\s|x|X|~)\]\s+/.exec(line);
    if (!m) continue;
    const ch = m[1] ?? " ";
    out.push({ done: ch === "x" || ch === "X", line });
  }
  return out;
}

async function defaultGitStatus(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
  return stdout;
}

async function defaultReadTasks(p: string): Promise<string> {
  return readFile(p, "utf8");
}

export async function plannerDryRun(
  input: PlannerDryRunInput,
): Promise<PlannerDryRunResult> {
  const readTasks = input.readTasks ?? defaultReadTasks;
  const gitStatus = input.gitStatus ?? defaultGitStatus;

  const tasksOutcome = await plannerSpecsAllComplete(
    input.specs,
    readTasks,
    parseCheckboxes,
  );
  if (tasksOutcome) return tasksOutcome;

  const gitOutcome = await plannerReposWorktreesClean(input.specs, gitStatus);
  if (gitOutcome) return gitOutcome;

  const attemptOutcome = plannerAttemptCounterClear(input.attempt_counter);
  if (attemptOutcome) return attemptOutcome;

  return { skip: true, reason: "all tasks checked, tree clean, no pending fixes" };
}
