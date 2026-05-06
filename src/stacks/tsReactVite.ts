import type { StackProfile } from "./types.js";

/**
 * ts-react-vite overlay. Mirrors vault `Build/Prompts/Stacks/ts-react-vite.md`
 * §StackProfile (TypeScript). Bump in lockstep w/ that file (A3 canon
 * pinned via `docs/playbook-expectations.md`).
 *
 * React UI stack profile. Scenario B (UI-only) + Scenario C (cross-repo)
 * integration tests exercise this profile w/ mock TF + mock gate exec.
 *
 * Note on `snapshotForbiddenFlags`: vault overlay names `vitest -u` /
 * `--update-snapshots` / `--ci=false`. We intentionally OMIT the bare `-u`
 * substring — `String.includes('-u')` would false-positive on `--user`,
 * `--update`, etc. (`enforceSnapshotFlagBan` is plain substring match,
 * matches existing javaSpringProfile precedent w/ unambiguous tokens only).
 * Reviewer regex enforcement gets the tighter `\b-u\b` check.
 */
export const tsReactViteProfile: StackProfile = {
  id: "ts-react-vite",
  packageManager: "pnpm",
  installCmd: ["pnpm", "install", "--frozen-lockfile"],
  qualityFastCmd: ["pnpm", "run", "check:fast"],
  qualityHeavyCmd: ["pnpm", "run", "check:heavy"],
  coverageCmd: ["pnpm", "run", "test:coverage"],
  coverageReportPath: "coverage/coverage-summary.json",
  coverageFloor: 0.85,
  mutationCmd: ["pnpm", "run", "mutate"],
  mutationReportPath: "reports/mutation/mutation.json",
  mutationFloor: 0.7,
  contractGenCmd: ["pnpm", "run", "contract:gen"],
  contractArtifactPath: "src/api/generated/index.ts",
  preflightCmd: ["node", "--version"],
  codegenGlobs: ["src/api/generated/**", "src/__generated__/**"],
  generatedMarkers: [
    "/* eslint-disable */",
    "// @generated",
    "DO NOT EDIT",
  ],
  testRoot: "src",
  sourceRoot: "src",
  snapshotForbiddenFlags: [
    "--update-snapshots",
    "--ci=false",
  ],
};
