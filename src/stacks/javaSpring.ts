import type { StackProfile } from "./types.js";

/**
 * java-spring overlay. Mirrors vault `Build/Prompts/Stacks/java-spring.md`
 * §StackProfile (TypeScript). Bump in lockstep w/ that file (A3 canon
 * pinned via `docs/playbook-expectations.md`).
 *
 * Phase 5: this is the only stack the supervisor / subagent / fix-subagent
 * fully exercise. Scenario A test (`tests/workflows/supervisorBranch.test.ts`)
 * runs against this profile w/ a mock gate exec.
 */
export const javaSpringProfile: StackProfile = {
  id: "java-spring",
  packageManager: "maven",
  installCmd: ["./mvnw", "install", "-DskipTests"],
  qualityFastCmd: ["./mvnw", "-T", "1C", "test", "-DfailIfNoTests=false"],
  qualityHeavyCmd: ["./mvnw", "verify"],
  coverageCmd: ["./mvnw", "jacoco:report"],
  coverageReportPath: "target/site/jacoco/jacoco.csv",
  coverageFloor: 0.8,
  mutationCmd: ["./mvnw", "org.pitest:pitest-maven:mutationCoverage"],
  mutationReportPath: "target/pit-reports/mutations.xml",
  mutationFloor: 0.65,
  contractGenCmd: ["./mvnw", "springdoc-openapi:generate"],
  contractArtifactPath: "target/openapi.json",
  preflightCmd: ["./mvnw", "-v"],
  codegenGlobs: ["target/generated-sources/**", "src/main/generated/**"],
  generatedMarkers: ["@Generated", "GENERATED — DO NOT EDIT"],
  testRoot: "src/test/java",
  sourceRoot: "src/main/java",
  /**
   * Note: `-DskipTests` is forbidden in subagent patches even though
   * `qualityFastCmd` includes `-DfailIfNoTests=false` (vault overlay
   * §Snapshot / auto-pass flags forbidden).
   */
  snapshotForbiddenFlags: [
    "-DskipTests",
    "-Dskip=true",
    "-Dmaven.test.skip=true",
  ],
};
