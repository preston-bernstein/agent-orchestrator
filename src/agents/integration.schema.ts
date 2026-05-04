import { z } from "zod";

/**
 * Integration agent output schema (O1 — structured outputs).
 *
 * Vault canon: `Build/Prompts/integration.md` §Output. Phase 6 MVP uses
 * deterministic-only path (O2 — `Build/Patterns/O2-deterministic-before-llm`):
 * hash compare + parse-diff is enough for Scenario C demo. LLM narrative for
 * ambiguous diffs lands Phase 7+.
 *
 * Status semantics:
 *   - `compatible`: contract hash unchanged OR diff is purely additive.
 *   - `breaking`: removed endpoint / removed required param / narrowed type
 *     / removed response field used by UI.
 *   - `needs_regen`: UI uses generated types; supervisor must spawn task to
 *     run `contractGenCmd` before merge.
 *   - `no_contract`: producer (Spring) `contract.spec_path` empty OR file
 *     missing — `proceed` w/ rationale.
 *   - `no_consumer`: consumer (React) `consumes_path` not set — `proceed`
 *     w/ rationale.
 */
export const IntegrationStatus = z.enum([
  "compatible",
  "breaking",
  "needs_regen",
  "no_contract",
  "no_consumer",
]);

export const IntegrationChange = z.object({
  path: z.string(),
  method: z.string(),
  change: z.enum([
    "added",
    "removed",
    "param_added_required",
    "param_removed",
    "response_field_added",
    "response_field_removed",
    "type_changed",
  ]),
  breaking: z.boolean(),
});

export const IntegrationDrift = z.object({
  file: z.string(),
  issue: z.string(),
});

export const IntegrationRecommended = z.enum([
  "proceed",
  "regenerate_ui_types",
  "block_merge",
  "human_clarify",
]);

export const IntegrationOutput = z.object({
  status: IntegrationStatus,
  rationale: z.string().max(200),
  contract_hash: z.string(),
  changed_endpoints: z.array(IntegrationChange).default([]),
  ui_drift: z.array(IntegrationDrift).default([]),
  recommended_action: IntegrationRecommended,
});
export type IntegrationOutputT = z.infer<typeof IntegrationOutput>;
export type IntegrationChangeT = z.infer<typeof IntegrationChange>;
export type IntegrationDriftT = z.infer<typeof IntegrationDrift>;
