import type { SpecSnapshotT } from "../../runs/RunContext.js";
import { caveman } from "../../gates/caveman.js";
import { assemblePrompt, type AssembledPrompt } from "../../llm/assemblePrompt.js";
import { PlannerOutput, type PlannerOutputT } from "./schema.js";
export { mockPlannerCompletion } from "./mockCompletion.js";

interface RunPlannerInput {
  specs: readonly SpecSnapshotT[];
  cli_flags: Readonly<Record<string, unknown>>;
  tf_capabilities?: { structured_output: boolean; tool_use: boolean };
  specBodies?: Readonly<Record<string, string>>;
  /** Observability hook — emitted after deterministic caveman on planner-side text. */
  onCavemanCompress?: (phase: "planner-header" | `spec:${string}`) => void;
}

interface RunPlannerDeps {
  completion: (prompt: AssembledPrompt) => Promise<unknown>;
}

export class PlannerSchemaError extends Error {
  constructor(
    public readonly issues: unknown,
    message = "planner output failed schema validation",
  ) {
    super(message);
    this.name = "PlannerSchemaError";
  }
}

const PLANNER_SYSTEM_PROMPT = [
  "you are Planner. one per run.",
  "input: frozen specs + RunContext. output: Zod-shaped plan.",
  "no nested plans. no subagent spawn. no codegen. no chain-of-thought.",
  "rationale ≤200 chars. tasks ≤20. refuse on no-spec / restricted-path / contract-order / >20 tasks / TF lacks structured output.",
].join("\n");

export async function runPlanner(
  input: RunPlannerInput,
  deps: RunPlannerDeps,
): Promise<PlannerOutputT> {
  if (input.tf_capabilities && !input.tf_capabilities.structured_output) {
    return {
      status: "refused",
      rationale: "tf lacks structured output (capability probe edge 45)",
      tasks: [],
      path_ownership_map: {},
      refusals: ["TF lacks structured output"],
    };
  }

  if (input.specs.length === 0) {
    return {
      status: "refused",
      rationale: "no specs provided to planner",
      tasks: [],
      path_ownership_map: {},
      refusals: ["no spec for any repo"],
    };
  }

  const specSummary = input.specs
    .map((s) => `- ${s.slug} (${s.repo}, stack=${s.stack})`)
    .join("\n");

  const bodies = input.specBodies ?? {};
  const cb = input.onCavemanCompress;
  const taskHeader = caveman({
    text: `plan changes across these specs:\n${specSummary}`,
  }).text;
  cb?.("planner-header");

  const xmlBlobs = input.specs.flatMap((s) => {
    const body = bodies[s.slug];
    if (!body) return [];
    const compressed = caveman({ text: body }).text;
    cb?.(`spec:${s.slug}`);
    return [{ tag: `spec:${s.slug}`, body: compressed }];
  });

  const prompt = assemblePrompt({
    caveman: taskHeader,
    basePrompt: PLANNER_SYSTEM_PROMPT,
    xmlBlobs,
    outputSchema:
      "PlannerOutput {status, rationale, tasks[≤20], path_ownership_map, refusals}",
    agentRole: "planner",
  });

  const raw = await deps.completion(prompt);
  const parsed = PlannerOutput.safeParse(raw);
  if (!parsed.success) {
    throw new PlannerSchemaError(parsed.error.issues);
  }
  return parsed.data;
}

