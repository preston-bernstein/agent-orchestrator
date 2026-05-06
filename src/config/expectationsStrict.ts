import type { ExpectationsSnapshot } from "./expectationsSnapshot.schema.js";

function throwIfStrictMissingDocSha(strict: boolean): void {
  if (!strict) return;
  throw new Error(
    "STRICT_EXPECTATIONS: EXPECTED_VAULT_SHA set but playbook-expectations.md has no vault_git_sha",
  );
}

function throwIfStrictShaMismatch(docSha: string, expectedFromEnv: string, strict: boolean): void {
  if (docSha === expectedFromEnv) return;
  if (!strict) return;
  throw new Error(`vault sha mismatch: doc=${docSha} env=${expectedFromEnv}`);
}

export function assertVaultShaAllowed(
  snapshot: ExpectationsSnapshot,
  expectedFromEnv: string | undefined,
  strict: boolean,
): void {
  if (!expectedFromEnv) return;
  if (!snapshot.vault_git_sha) {
    throwIfStrictMissingDocSha(strict);
    return;
  }
  throwIfStrictShaMismatch(snapshot.vault_git_sha, expectedFromEnv, strict);
}
