import type { PlannerDryRunInput, PlannerDryRunSpec } from "./types.js";

interface PlannerDryRunResult {
  skip: boolean;
  reason: string;
}

export async function plannerDryRunOneSpec(
  spec: PlannerDryRunSpec,
  readTasks: NonNullable<PlannerDryRunInput["readTasks"]>,
  parseCheckboxes: (md: string) => { done: boolean; line: string }[],
): Promise<PlannerDryRunResult | null> {
  let raw = "";
  try {
    raw = await readTasks(spec.tasks_path);
  } catch {
    return { skip: false, reason: `tasks.md missing: ${spec.slug}` };
  }
  const boxes = parseCheckboxes(raw);
  if (boxes.length === 0) return { skip: false, reason: `no tasks parsed: ${spec.slug}` };
  if (boxes.some((b) => !b.done)) return { skip: false, reason: `open tasks: ${spec.slug}` };
  return null;
}

export async function plannerSpecsAllComplete(
  specs: readonly PlannerDryRunSpec[],
  readTasks: NonNullable<PlannerDryRunInput["readTasks"]>,
  parseCheckboxes: (md: string) => { done: boolean; line: string }[],
): Promise<PlannerDryRunResult | null> {
  for (const spec of specs) {
    const hit = await plannerDryRunOneSpec(spec, readTasks, parseCheckboxes);
    if (hit) return hit;
  }
  return null;
}

export async function plannerReposWorktreesClean(
  specs: readonly PlannerDryRunSpec[],
  gitStatus: NonNullable<PlannerDryRunInput["gitStatus"]>,
): Promise<PlannerDryRunResult | null> {
  for (const spec of specs) {
    let status = "";
    try {
      status = await gitStatus(spec.repo);
    } catch {
      return { skip: false, reason: `git status failed: ${spec.repo}` };
    }
    if (status.trim() !== "") return { skip: false, reason: `working tree dirty: ${spec.repo}` };
  }
  return null;
}

export function plannerAttemptCounterClear(
  counter: Readonly<Record<string, number>> | undefined,
): PlannerDryRunResult | null {
  if (!counter) return null;
  const stuck = Object.entries(counter).find(([, n]) => typeof n === "number" && n > 0);
  return stuck ? { skip: false, reason: `prior fix-loop pending: ${stuck[0]}` } : null;
}
