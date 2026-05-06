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
