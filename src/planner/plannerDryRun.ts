import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * O5 — Planner dry-run. Pre-LLM no-op detection. Skip planner LLM entirely
 * when:
 *   1. every spec `tasks.md` checkbox is `[x]`
 *   2. working tree clean (`git status --porcelain` empty)
 *   3. no prior fix-loop in flight (`attempt_counter[*] === 0`)
 *
 * Vault canon: `Build/Patterns/O5-planner-dry-run.md`. Read-only — never
 * mutates `tasks.md`. Returns reason string for audit `planner_skipped`
 * event upstream (workflow caller appends).
 */

export interface PlannerDryRunSpec {
  slug: string;
  tasks_path: string;
  /** repo path for `git status` cwd. */
  repo: string;
}

export interface PlannerDryRunInput {
  specs: readonly PlannerDryRunSpec[];
  /** RunContext.attempt_counter — keys: step ids, values: retry count. */
  attempt_counter?: Readonly<Record<string, number>>;
  /** Injection seam: override `git status` runner (tests). */
  gitStatus?: (cwd: string) => Promise<string>;
  /** Injection seam: override file reader (tests). */
  readTasks?: (path: string) => Promise<string>;
}

export interface PlannerDryRunResult {
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

async function plannerSpecsAllComplete(
  specs: readonly PlannerDryRunSpec[],
  readTasks: NonNullable<PlannerDryRunInput["readTasks"]>,
): Promise<PlannerDryRunResult | null> {
  for (const spec of specs) {
    let raw: string;
    try {
      raw = await readTasks(spec.tasks_path);
    } catch {
      return { skip: false, reason: `tasks.md missing: ${spec.slug}` };
    }
    const boxes = parseCheckboxes(raw);
    if (boxes.length === 0) {
      return { skip: false, reason: `no tasks parsed: ${spec.slug}` };
    }
    const open = boxes.filter((b) => !b.done);
    if (open.length > 0) {
      return { skip: false, reason: `open tasks: ${spec.slug}` };
    }
  }
  return null;
}

async function plannerReposWorktreesClean(
  specs: readonly PlannerDryRunSpec[],
  gitStatus: NonNullable<PlannerDryRunInput["gitStatus"]>,
): Promise<PlannerDryRunResult | null> {
  for (const spec of specs) {
    let status: string;
    try {
      status = await gitStatus(spec.repo);
    } catch {
      return { skip: false, reason: `git status failed: ${spec.repo}` };
    }
    if (status.trim() !== "") {
      return { skip: false, reason: `working tree dirty: ${spec.repo}` };
    }
  }
  return null;
}

function plannerAttemptCounterClear(
  counter: Readonly<Record<string, number>> | undefined,
): PlannerDryRunResult | null {
  if (!counter) return null;
  const stuck = Object.entries(counter).find(
    ([, n]) => typeof n === "number" && n > 0,
  );
  if (stuck) {
    return { skip: false, reason: `prior fix-loop pending: ${stuck[0]}` };
  }
  return null;
}

export async function plannerDryRun(
  input: PlannerDryRunInput,
): Promise<PlannerDryRunResult> {
  const readTasks = input.readTasks ?? defaultReadTasks;
  const gitStatus = input.gitStatus ?? defaultGitStatus;

  const tasksOutcome = await plannerSpecsAllComplete(input.specs, readTasks);
  if (tasksOutcome) return tasksOutcome;

  const gitOutcome = await plannerReposWorktreesClean(input.specs, gitStatus);
  if (gitOutcome) return gitOutcome;

  const attemptOutcome = plannerAttemptCounterClear(input.attempt_counter);
  if (attemptOutcome) return attemptOutcome;

  return { skip: true, reason: "all tasks checked, tree clean, no pending fixes" };
}
