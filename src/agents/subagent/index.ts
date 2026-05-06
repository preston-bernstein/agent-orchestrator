import type { PlannerTaskT } from "../planner/schema.js";
import { caveman } from "../../gates/caveman.js";
import { assemblePrompt, type AssembledPrompt } from "../../llm/assemblePrompt.js";
import type { StackProfile } from "../../stacks/types.js";
import {
  SubagentOutput,
  type SubagentOutputT,
} from "./schema.js";
import { enforceFilesTouched, enforceSnapshotFlagBan } from "./guards.js";
export { enforceFilesTouched, enforceSnapshotFlagBan } from "./guards.js";

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
  stackOverlay?: string;
  stackProfile: StackProfile;
  task_files?: Readonly<Record<string, string>>;
  path_ownership_map: Readonly<Record<string, readonly string[]>>;
  ownerKey?: string;
}

interface RunSubagentDeps {
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
