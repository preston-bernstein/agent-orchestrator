import type { PlannerTaskT } from "./planner.schema.js";
import { caveman } from "../gates/caveman.js";
import { assemblePrompt, type AssembledPrompt } from "../llm/assemblePrompt.js";
import type { StackProfile } from "../stacks/types.js";
import {
  SubagentOutput,
  type SubagentOutputT,
} from "./subagent.schema.js";

/**
 * Generic Subagent (vault `Build/Prompts/subagent-base.md`). Receives ONE
 * task; emits ONE unified diff via the injected `completion` deps. Does
 * NOT shell out, NOT call FS — orchestrator pre-supplies file content via
 * `task_files` (read-only).
 *
 * Stack overlay (`StackProfile`) is appended to the base prompt at runtime
 * — codegen path bans + snapshot-flag bans + test-root convention live in
 * the overlay.
 *
 * Phase 5: real TF wiring deferred — `MOCK_TF=1` + `mockSubagentCompletion`
 * keep tests offline. Real TF lands w/ Phase 5+ work in tasks 36–40.
 */

const SUBAGENT_BASE_PROMPT = [
  "you are Subagent. one task. one unified diff.",
  "no shell. no FS. no other agents. no `as any`/`@ts-ignore`/raw widen.",
  "files_touched ⊆ task.paths. else refuse `out of scope: <p>`.",
  "patch touches behavior ⇒ patch must include test change. else refuse `no test for behavior change`.",
  "no `--update-snapshots`/`-u`/snapshot regen. refuse `snapshot auto-pass forbidden`.",
  "rationale ≤200 chars. no chain-of-thought.",
].join("\n");

interface RunSubagentInput {
  task: PlannerTaskT;
  /** Stack overlay appended at runtime (overlay text, not just profile). */
  stackOverlay?: string;
  stackProfile: StackProfile;
  /** Read-only file content for paths in `task.paths` (orchestrator-supplied). */
  task_files?: Readonly<Record<string, string>>;
  /** path_ownership_map snapshot from RunContext (assembler enforces). */
  path_ownership_map: Readonly<Record<string, readonly string[]>>;
  /**
   * Owner key into `path_ownership_map`. Defaults to `task.id` (assembler
   * checks declared paths ⊆ allowed globs — first defense, edge 7).
   */
  ownerKey?: string;
}

interface RunSubagentDeps {
  /** Send assembled prompt to TF; returns Zod-shaped SubagentOutput-like. */
  completion: (prompt: AssembledPrompt) => Promise<unknown>;
}

export class SubagentSchemaError extends Error {
  constructor(
    public readonly issues: unknown,
    message = "subagent output failed schema validation",
  ) {
    super(message);
    this.name = "SubagentSchemaError";
  }
}

/**
 * Defensive post-LLM check. Refuses w/ `'out of scope: <path>'` even if the
 * model lied + slipped a path past assembly. Vault canon: subagent-base
 * §Behavior #1.
 */
export function enforceFilesTouched(
  out: SubagentOutputT,
  taskPaths: readonly string[],
): SubagentOutputT {
  if (out.status !== "patch") return out;
  const allowed = new Set(taskPaths);
  for (const f of out.files_touched) {
    const inLane = taskPaths.some((p) => f === p || pathInGlob(f, p));
    if (!inLane && !allowed.has(f)) {
      return {
        ...out,
        status: "refused",
        patch: "",
        rationale: `out of scope: ${f}`,
        refusals: [...out.refusals, `out of scope: ${f}`],
      };
    }
  }
  return out;
}

/**
 * Defensive ban-list check vs StackProfile.snapshotForbiddenFlags. Mirrors
 * vault subagent-base §Behavior #3 ("snapshot auto-pass forbidden").
 */
export function enforceSnapshotFlagBan(
  out: SubagentOutputT,
  profile: StackProfile,
): SubagentOutputT {
  if (out.status !== "patch") return out;
  for (const flag of profile.snapshotForbiddenFlags) {
    if (out.patch.includes(flag)) {
      return {
        ...out,
        status: "refused",
        patch: "",
        rationale: `snapshot auto-pass forbidden: ${flag}`,
        refusals: [...out.refusals, `snapshot auto-pass forbidden: ${flag}`],
      };
    }
  }
  return out;
}

/**
 * Tiny glob match for ban-check (suffix `**` only). assemblePrompt has the
 * full impl; here we just need "is this file under that glob root?" — keep
 * surface minimal so subagent stays a pure-fn in tests.
 */
function pathInGlob(filePath: string, glob: string): boolean {
  if (glob === filePath) return true;
  if (glob.endsWith("/**")) {
    const root = glob.slice(0, -3);
    return filePath === root || filePath.startsWith(root + "/");
  }
  if (glob.endsWith("**")) {
    const root = glob.slice(0, -2);
    return filePath.startsWith(root);
  }
  return false;
}

export async function runSubagent(
  input: RunSubagentInput,
  deps: RunSubagentDeps,
): Promise<SubagentOutputT> {
  const ownerKey = input.ownerKey ?? input.task.id;
  const compressedTitle = caveman({ text: input.task.title }).text;

  const fileBlobs = Object.entries(input.task_files ?? {}).map(([p, body]) => ({
    tag: `file:${p}`,
    body,
  }));

  const taskBlob = [
    `task_id: ${input.task.id}`,
    `repo: ${input.task.repo}`,
    `paths: ${input.task.paths.join(", ")}`,
    `depends_on: ${input.task.depends_on.join(", ") || "none"}`,
  ].join("\n");

  const prompt = assemblePrompt({
    caveman: compressedTitle,
    basePrompt: SUBAGENT_BASE_PROMPT,
    stackOverlay: input.stackOverlay,
    taskContext: taskBlob,
    xmlBlobs: fileBlobs,
    outputSchema:
      "SubagentOutput {status, rationale, patch, files_touched, refusals, context_request}",
    agentRole: `subagent:${input.task.id}`,
    declaredPaths: input.task.paths,
    pathOwnership: input.path_ownership_map,
    ownerKey,
  });

  return invokeAndParse(deps.completion, prompt, input.task.paths, input.stackProfile);
}

export async function invokeAndParse(
  completion: (prompt: AssembledPrompt) => Promise<unknown>,
  prompt: AssembledPrompt,
  taskPaths: readonly string[],
  stackProfile: StackProfile,
): Promise<SubagentOutputT> {
  const raw = await completion(prompt);
  const parsed = SubagentOutput.safeParse(raw);
  if (!parsed.success) {
    throw new SubagentSchemaError(parsed.error.issues);
  }
  let out = parsed.data;
  out = enforceFilesTouched(out, taskPaths);
  out = enforceSnapshotFlagBan(out, stackProfile);
  return out;
}

/**
 * Deterministic mock completion for `MOCK_TF=1` lane. Echoes a single-file
 * patch under `task.paths[0]` — just enough for Scenario A integration
 * test. Vault canon: O4 (`Build/Patterns/O4-mock-tf-fixtures.md`).
 */
export function mockSubagentCompletion(
  patch: string = "diff --git a/mock b/mock\n",
  files_touched?: readonly string[],
): (prompt: AssembledPrompt) => Promise<SubagentOutputT> {
  return async () => ({
    status: "patch",
    rationale: "mock TF — fixture patch",
    patch,
    files_touched: files_touched ? [...files_touched] : ["mock"],
    refusals: [],
    context_request: [],
  });
}
