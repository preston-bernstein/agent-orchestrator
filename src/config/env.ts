import { z } from "zod";

const envSchema = z.object({
  TF_BASE_URL: z.string().url().optional(),
  TF_API_KEY: z.string().min(1).optional(),
  RUNS_DIR: z.string().default("./runs"),
  EXPECTED_VAULT_SHA: z.string().min(7).max(64).optional(),
});

export type BootConfig = z.infer<typeof envSchema> & {
  strictExpectations: boolean;
};

export function loadBootConfig(env = process.env): BootConfig {
  const v = env.STRICT_EXPECTATIONS;
  const strictExpectations = v === "1" || v === "true";
  const parsed = envSchema.parse({
    TF_BASE_URL: env.TF_BASE_URL,
    TF_API_KEY: env.TF_API_KEY,
    RUNS_DIR: env.RUNS_DIR,
    EXPECTED_VAULT_SHA: env.EXPECTED_VAULT_SHA,
  });
  return { ...parsed, strictExpectations };
}
