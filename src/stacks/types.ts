/**
 * StackProfile — vault canon `Build/Prompts/Stacks/Index.md` +
 * `Examples/docs/decisions/2026-05-02-0002-stack-profile-abstraction.md`.
 *
 * One profile per stack id (`java-spring`, `ts-react-vite`, `ts-node`).
 * Drives `runQuality` gate dispatch + supervisor/subagent overlay loader.
 *
 * Phase 5 ships only `java-spring` (per Playbook §Phase 5 — pick one stack
 * first; React lands Phase 6). Profile shape is shared so adding a stack
 * later is a registry insert, not a fork.
 */
export interface StackProfile {
  /** Stack id — matches `SpecSnapshot.stack` enum value. */
  id: string;
  /** `maven` | `gradle` | `pnpm` | `npm` | `cargo` … */
  packageManager: string;

  /** Argv for one-shot dependency install (preflight). */
  installCmd: readonly string[];
  /** Cheap gate: compile + unit tests, no integration. Phase 5 default. */
  qualityFastCmd: readonly string[];
  /** Heavy gate: full verify (integration + coverage + contract gen). */
  qualityHeavyCmd: readonly string[];
  /** Coverage report generator argv. */
  coverageCmd: readonly string[];
  /** Path (relative to repo) to coverage report file (CSV / XML). */
  coverageReportPath: string;
  /** Floor as fraction in [0,1]. Reviewer reads + compares. */
  coverageFloor: number;
  /** Mutation score generator argv. */
  mutationCmd: readonly string[];
  /** Path to mutation report. */
  mutationReportPath: string;
  /** Mutation floor as fraction in [0,1]. */
  mutationFloor: number;
  /** Contract artifact generator (edge 1 — API repo only). */
  contractGenCmd?: readonly string[];
  /** Path to generated contract artifact (e.g. openapi.json). */
  contractArtifactPath?: string;
  /** Toolchain probe (e.g. `mvn -v`). Run before any task. */
  preflightCmd: readonly string[];

  /** Globs marking codegen output — subagents refuse on touch. */
  codegenGlobs: readonly string[];
  /** Inline file markers signalling generated code. */
  generatedMarkers: readonly string[];

  /** Test source root (relative to repo). */
  testRoot: string;
  /** Production source root. */
  sourceRoot: string;

  /**
   * Snapshot/auto-pass flag substrings the subagent + reviewer refuse if seen
   * in any patch (e.g. `--update-snapshots`, `-DskipTests`). Vault canon:
   * `Build/Prompts/subagent-base.md` §Behavior #3 — overlay names them.
   */
  snapshotForbiddenFlags: readonly string[];
}
