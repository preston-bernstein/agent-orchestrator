import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertVaultShaAllowed, loadExpectations } from "../config/expectations.js";
import { loadBootConfig } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

async function main(): Promise<void> {
  const cfg = loadBootConfig();
  const { snapshot, warnings } = await loadExpectations(repoRoot);
  for (const w of warnings) {
    console.warn(`[expectations] ${w}`);
  }
  assertVaultShaAllowed(snapshot, cfg.EXPECTED_VAULT_SHA, cfg.strictExpectations);
  console.log(
    JSON.stringify(
      {
        ok: true,
        expectations_snapshot: {
          doc_sha256: snapshot.docSha256 || null,
          vault_git_sha: snapshot.vault_git_sha ?? null,
        },
        strictExpectations: cfg.strictExpectations,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
