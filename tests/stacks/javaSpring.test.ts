import { describe, expect, it } from "vitest";
import {
  UnknownStackError,
  getStackProfile,
  javaSpringProfile,
  listStackIds,
} from "../../src/stacks/index.js";

describe("javaSpringProfile (Build/Prompts/Stacks/java-spring.md mirror)", () => {
  it("matches vault overlay §StackProfile field names + values", () => {
    expect(javaSpringProfile.id).toBe("java-spring");
    expect(javaSpringProfile.packageManager).toBe("maven");
    expect(javaSpringProfile.qualityFastCmd).toEqual([
      "./mvnw",
      "-T",
      "1C",
      "test",
      "-DfailIfNoTests=false",
    ]);
    expect(javaSpringProfile.qualityHeavyCmd).toEqual(["./mvnw", "verify"]);
    expect(javaSpringProfile.contractArtifactPath).toBe("target/openapi.json");
    expect(javaSpringProfile.coverageFloor).toBe(0.8);
    expect(javaSpringProfile.mutationFloor).toBe(0.65);
  });

  it("forbids -DskipTests in patches even though gate cmd uses -DfailIfNoTests=false", () => {
    expect(javaSpringProfile.snapshotForbiddenFlags).toContain("-DskipTests");
    expect(javaSpringProfile.qualityFastCmd).toContain("-DfailIfNoTests=false");
  });

  it("declares codegen globs + markers (subagent guard)", () => {
    expect(javaSpringProfile.codegenGlobs).toContain(
      "target/generated-sources/**",
    );
    expect(javaSpringProfile.generatedMarkers).toContain("@Generated");
  });
});

describe("stack registry", () => {
  it("looks up java-spring by id", () => {
    const p = getStackProfile("java-spring");
    expect(p).toBe(javaSpringProfile);
  });

  it("throws UnknownStackError on unknown id", () => {
    expect(() => getStackProfile("rust-axum")).toThrow(UnknownStackError);
  });

  it("listStackIds includes java-spring", () => {
    expect(listStackIds()).toContain("java-spring");
  });
});
