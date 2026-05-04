import type { PlannerTaskT } from "./planner.schema.js";
import { caveman } from "../gates/caveman.js";
import { assemblePrompt, type AssembledPrompt } from "../llm/assemblePrompt.js";
import type { StackProfile } from "../stacks/types.js";
import {
  SubagentOutput,
  type SubagentOutputT,
} from "./subagent.schema.js";
import {
  SubagentSchemaError,
  enforceFilesTouched,
  enforceSnapshotFlagBan,
} from "./subagent.js";

/**
 * Fix-Subagent (vault `Build/Prompts/fix-subagent.md`). Narrowed subagent
 * for fix-loops. Reads failing gate log + prior patch + same task slice;
 * emits ONE minimal diff that fixes the failing gate without rewriting
 * working code.
 *
 * Output shape == `SubagentOutput` (vault canon). Behavior deltas vs base:
 *  - `attempt >= max_fix_loops` ⇒ orchestrator should not have called us;
 *    refuse `'fix budget exceeded'` (defensive).
 *  - rationale must cite gate_log line (caller validates upstream;
 *    schema-level ≤200 chars enforced).
 *  - `files_touched.length > 4` ⇒ orchestrator MAY refuse upstream
 *    (`fix scope too large`); we surface the raw patch + supervisor
 *    decides.
 */

export const FIX_SUBAGENT_BASE_PROMPT = [
  "you are Fix-Subagent. one minimal diff. fix failing gate. do NOT rewrite.",
  "rationale must cite gate_log line. ≤200 chars.",
  "no `@ts-ignore`/`as any`/`// eslint-disable`/`@SuppressWarnings`. silencing != fixing.",
  "no snapshot regen. no test-assertion edits to make red green (`test asserts wrong` ⇒ refuse).",
  "files_touched typically 1–2; >4 ⇒ refuse `fix scope too large`.",
  "one try per call. emit one diff. end.",
].join("\n");

export interface RunFixSubagentInput {
  task: PlannerTaskT;
  stackOverlay?: string;
  stackProfile: StackProfile;
  /** Prior subagent patch (the diff we're trying to fix). */
  prior_patch: string;
  /** Last ~200 lines of gate stdout/stderr (already truncated, edge 3). */
  gate_log_excerpt: string;
  /** Name of the failing gate (e.g. `mvn-verify`, `vitest`). */
  failing_gate: string;
  /** 1-indexed attempt count; capped at `max_fix_loops`. */
  attempt: number;
  /** Soft cap for cycle-aware refusal (vault: edge 10). */
  max_fix_loops: number;
  /** path_ownership_map snapshot (assembler enforces). */
  path_ownership_map: Readonly<Record<string, readonly string[]>>;
  ownerKey?: string;
}

export interface RunFixSubagentDeps {
  completion: (prompt: AssembledPrompt) => Promise<unknown>;
}

export async function runFixSubagent(
  input: RunFixSubagentInput,
  deps: RunFixSubagentDeps,
): Promise<SubagentOutputT> {
  if (input.attempt > input.max_fix_loops) {
    return {
      status: "refused",
      rationale: `fix budget exceeded: attempt=${input.attempt} cap=${input.max_fix_loops}`,
      patch: "",
      files_touched: [],
      refusals: ["fix budget exceeded"],
      context_request: [],
    };
  }

  const ownerKey = input.ownerKey ?? input.task.id;
  const header = caveman({
    text: `fix attempt ${input.attempt}/${input.max_fix_loops}: ${input.failing_gate} fail on ${input.task.id}`,
  }).text;

  const prompt = assemblePrompt({
    caveman: header,
    basePrompt: FIX_SUBAGENT_BASE_PROMPT,
    stackOverlay: input.stackOverlay,
    taskContext: [
      `task_id: ${input.task.id}`,
      `paths: ${input.task.paths.join(", ")}`,
      `failing_gate: ${input.failing_gate}`,
      `attempt: ${input.attempt}/${input.max_fix_loops}`,
    ].join("\n"),
    xmlBlobs: [
      { tag: "prior_patch", body: input.prior_patch },
      { tag: "gate_log_excerpt", body: input.gate_log_excerpt },
    ],
    outputSchema:
      "SubagentOutput {status, rationale, patch, files_touched, refusals, context_request}",
    agentRole: `fix-subagent:${input.task.id}`,
    declaredPaths: input.task.paths,
    pathOwnership: input.path_ownership_map,
    ownerKey,
  });

  const raw = await deps.completion(prompt);
  const parsed = SubagentOutput.safeParse(raw);
  if (!parsed.success) {
    throw new SubagentSchemaError(parsed.error.issues);
  }
  let out = parsed.data;
  out = enforceFilesTouched(out, input.task.paths);
  out = enforceSnapshotFlagBan(out, input.stackProfile);
  return out;
}

/**
 * Deterministic mock fix completion for tests. Returns a one-line patch
 * that "fixes" by toggling — Scenario A test asserts the supervisor swaps
 * gate exec to a green stub on the next attempt. Caller supplies
 * `files_touched` so post-LLM scope check (`enforceFilesTouched`) sees a
 * lane-conformant fixture.
 */
export function mockFixSubagentCompletion(
  patch: string = "diff --git a/mock-fix b/mock-fix\n",
  files_touched: readonly string[] = ["mock-fix"],
): (prompt: AssembledPrompt) => Promise<SubagentOutputT> {
  return async () => ({
    status: "patch",
    rationale: "mock fix — addresses gate_log line 1",
    patch,
    files_touched: [...files_touched],
    refusals: [],
    context_request: [],
  });
}
