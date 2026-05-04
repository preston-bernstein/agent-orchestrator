import type { SpecSnapshotT } from "../runs/RunContext.js";
import { caveman } from "../gates/caveman.js";
import { assemblePrompt, type AssembledPrompt } from "../llm/assemblePrompt.js";
import { PlannerOutput, type PlannerOutputT } from "./planner.schema.js";

/**
 * Single Planner agent (vault canon: `Build/Prompts/planner.md`). Reads
 * frozen specs + RunContext, emits Zod-validated `PlannerOutput`. Does NOT
 * call subagents, NOT execute anything — supervisor takes hand-off.
 *
 * O5 (`plannerDryRun`) runs **upstream** — when invoked here, dry-run
 * already said `skip:false`. Output `skipped_no_change_needed` is
 * reconcile-only (rare).
 *
 * TF call is injected via `deps.completion`; mock lane (`MOCK_TF=1`)
 * passes a deterministic fixture so dry-plan integration tests stay
 * offline.
 */

export interface RunPlannerInput {
  specs: readonly SpecSnapshotT[];
  cli_flags: Readonly<Record<string, unknown>>;
  tf_capabilities?: { structured_output: boolean; tool_use: boolean };
  /** raw spec body text per slug — caller pre-loads to keep planner pure-fn. */
  specBodies?: Readonly<Record<string, string>>;
}

export interface RunPlannerDeps {
  /**
   * Send assembled prompt to TF (or mock). MUST return Zod-validated
   * `PlannerOutput`. Caller is responsible for structured-output enforcement
   * (O1) — runtime swap point for real TF JSON-mode.
   */
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
  const xmlBlobs = input.specs.flatMap((s) => {
    const body = bodies[s.slug];
    if (!body) return [];
    const compressed = caveman({ text: body }).text;
    return [{ tag: `spec:${s.slug}`, body: compressed }];
  });

  const taskHeader = caveman({
    text: `plan changes across these specs:\n${specSummary}`,
  }).text;

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

/**
 * Deterministic mock completion for `MOCK_TF=1` lane (vault `Build/
 * Patterns/O4-mock-tf-fixtures.md`). Echoes a single ready task per spec —
 * just enough for `--dry-plan` integration tests to assert plan.json
 * artifact + audit `dry_plan` event.
 */
export function mockPlannerCompletion(
  specs: readonly SpecSnapshotT[],
): (prompt: AssembledPrompt) => Promise<PlannerOutputT> {
  return async () => {
    if (specs.length === 0) {
      return {
        status: "refused",
        rationale: "mock: no specs",
        tasks: [],
        path_ownership_map: {},
        refusals: ["no spec"],
      };
    }
    const tasks = specs.map((s, i) => ({
      id: `mock-T${i + 1}`,
      spec_slug: s.slug,
      repo: (s.repo === "spring-api" || s.repo === "react-ui"
        ? s.repo
        : "agent-orchestrator") as "spring-api" | "react-ui" | "agent-orchestrator",
      supervisor: (s.repo === "spring-api"
        ? "spring"
        : s.repo === "react-ui"
          ? "react"
          : "orch") as "spring" | "react" | "orch",
      title: `mock task for ${s.slug}`,
      paths: [`mock/${s.slug}/**`],
      depends_on: [] as string[],
    }));
    const path_ownership_map: Record<string, string[]> = {};
    for (const t of tasks) path_ownership_map[t.id] = t.paths;
    return {
      status: "ready",
      rationale: "mock TF — fixture plan for offline tests",
      tasks,
      path_ownership_map,
      refusals: [],
    };
  };
}
