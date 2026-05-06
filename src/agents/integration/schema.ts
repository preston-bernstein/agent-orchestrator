import { z } from "zod";

const IntegrationStatus = z.enum([
  "compatible",
  "breaking",
  "needs_regen",
  "no_contract",
  "no_consumer",
]);

const IntegrationChange = z.object({
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

const IntegrationDrift = z.object({
  file: z.string(),
  issue: z.string(),
});

const IntegrationRecommended = z.enum([
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
