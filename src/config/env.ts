import { z } from "zod";

const envSchema = z.object({
  TF_BASE_URL: z.string().url().optional(),
  TF_API_KEY: z.string().min(1).optional(),
  RUNS_DIR: z.string().default("./runs"),
  EXPECTED_VAULT_SHA: z.string().min(7).max(64).optional(),
  ORCH_MANAGED_REPOS: z.string().optional(),
  /** Base for `/runs/:id/audit` artifact links from CLI summaries (loopback dev default). */
  ORCH_ARTIFACT_BASE_URL: z.string().url().optional(),
  // Inngest (I2) — optional at boot. `pnpm run orchestrate -- --spec …` sends
  // events: no `INNGEST_EVENT_KEY` needed on a dev laptop if `INNGEST_DEV` is
  // unset (SDK infers dev) or `INNGEST_DEV=1`. Set `INNGEST_DEV=0` only when
  // you intend cloud-style sends + a real key. `inngest:serve` uses signing key.
  // ADR 0002 — `INNGEST_BASE_URL` loopback/LAN unless org says otherwise.
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  INNGEST_BASE_URL: z.string().url().optional(),
});

export type BootConfig = z.infer<typeof envSchema> & {
  strictExpectations: boolean;
  skipTfProbe: boolean;
  inngestDev: boolean;
  /** `MOCK_TF=1|true` — planner/subagent mocks; required for execute lane inside Inngest until real TF. */
  mockTf: boolean;
};

export function loadBootConfig(env = process.env): BootConfig {
  const strict = env.STRICT_EXPECTATIONS;
  const strictExpectations = strict === "1" || strict === "true";
  const skip = env.TF_SKIP_PROBE;
  const skipTfProbe = skip === "1" || skip === "true";
  const dev = env.INNGEST_DEV;
  const inngestDev = dev === "1" || dev === "true";
  const mockTf = env.MOCK_TF === "1" || env.MOCK_TF?.toLowerCase() === "true";
  const parsed = envSchema.parse({
    TF_BASE_URL: env.TF_BASE_URL,
    TF_API_KEY: env.TF_API_KEY,
    RUNS_DIR: env.RUNS_DIR,
    EXPECTED_VAULT_SHA: env.EXPECTED_VAULT_SHA,
    ORCH_MANAGED_REPOS: env.ORCH_MANAGED_REPOS,
    ORCH_ARTIFACT_BASE_URL: env.ORCH_ARTIFACT_BASE_URL,
    INNGEST_EVENT_KEY: env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: env.INNGEST_SIGNING_KEY,
    INNGEST_BASE_URL: env.INNGEST_BASE_URL,
  });
  return { ...parsed, strictExpectations, skipTfProbe, inngestDev, mockTf };
}

/**
 * TrustFoundry credentials are required to run the orchestrator (EARS:
 * refuse to start if `TF_BASE_URL` or `TF_API_KEY` missing). Audit-only
 * surfaces (e.g. `audit:verify`) call `loadBootConfig` directly and skip
 * this assertion.
 */
export interface TfConfig {
  baseUrl: string;
  apiKey: string;
}

export function requireTfConfig(cfg: BootConfig): TfConfig {
  const missing: string[] = [];
  if (!cfg.TF_BASE_URL) missing.push("TF_BASE_URL");
  if (!cfg.TF_API_KEY) missing.push("TF_API_KEY");
  if (missing.length > 0) {
    throw new Error(
      `boot refused: missing ${missing.join(" + ")} — set in .env per .env.example`,
    );
  }
  return { baseUrl: cfg.TF_BASE_URL as string, apiKey: cfg.TF_API_KEY as string };
}
