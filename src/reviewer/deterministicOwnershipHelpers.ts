import type { ManagedRepoMap, SupervisorId } from "../config/managedRepos.js";
import type { PlannerOutputT } from "../agents/planner/schema.js";

function appendOwnershipGlobsForTask(
  t: PlannerOutputT["tasks"][number],
  supervisorId: string,
  pom: Record<string, readonly string[] | undefined>,
  globs: string[],
): void {
  if (t.supervisor !== supervisorId) return;
  const g = pom[t.id];
  if (g) globs.push(...g);
}

export function unionOwnershipGlobsForSupervisor(
  plan: PlannerOutputT,
  supervisorId: string,
): string[] {
  const pom = plan.path_ownership_map ?? {};
  const globs: string[] = [];
  for (const t of plan.tasks) {
    appendOwnershipGlobsForTask(t, supervisorId, pom, globs);
  }
  return [...new Set(globs)];
}

export function codegenGlobsForSupervisor(
  repos: ManagedRepoMap,
  supervisorId: string,
): string[] {
  const entry = repos[supervisorId as SupervisorId];
  if (!entry) return [];
  const fromMeta = entry.meta.codegen_paths ?? [];
  const fromProfile = entry.profile.codegenGlobs ?? [];
  return [...new Set([...fromMeta, ...fromProfile])];
}

export function restrictedGlobsForSupervisor(
  repos: ManagedRepoMap,
  supervisorId: string,
): string[] {
  return repos[supervisorId as SupervisorId]?.meta.restricted_paths ?? [];
}
