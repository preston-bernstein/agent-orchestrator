import { describe, expect, it } from "vitest";
import {
  getStackProfile,
  listStackIds,
  tsReactViteProfile,
} from "../../src/stacks/index.js";

describe("tsReactViteProfile (Build/Prompts/Stacks/ts-react-vite.md mirror)", () => {
  it("matches vault overlay §StackProfile field names + values", () => {
    expect(tsReactViteProfile.id).toBe("ts-react-vite");
    expect(tsReactViteProfile.packageManager).toBe("pnpm");
    expect(tsReactViteProfile.installCmd).toEqual([
      "pnpm",
      "install",
      "--frozen-lockfile",
    ]);
    expect(tsReactViteProfile.qualityFastCmd).toEqual([
      "pnpm",
      "run",
      "check:fast",
    ]);
    expect(tsReactViteProfile.qualityHeavyCmd).toEqual([
      "pnpm",
      "run",
      "check:heavy",
    ]);
    expect(tsReactViteProfile.contractArtifactPath).toBe(
      "src/api/generated/index.ts",
    );
    expect(tsReactViteProfile.coverageFloor).toBe(0.85);
    expect(tsReactViteProfile.mutationFloor).toBe(0.7);
  });

  it("forbids unambiguous snapshot/auto-pass flag substrings", () => {
    expect(tsReactViteProfile.snapshotForbiddenFlags).toContain(
      "--update-snapshots",
    );
    expect(tsReactViteProfile.snapshotForbiddenFlags).toContain("--ci=false");
  });

  it("intentionally omits bare `-u` (substring false-positive risk)", () => {
    expect(tsReactViteProfile.snapshotForbiddenFlags).not.toContain("-u");
  });

  it("declares codegen globs + markers (subagent guard)", () => {
    expect(tsReactViteProfile.codegenGlobs).toContain(
      "src/api/generated/**",
    );
    expect(tsReactViteProfile.generatedMarkers).toContain("// @generated");
  });
});

describe("stack registry — Phase 6 includes ts-react-vite", () => {
  it("looks up ts-react-vite by id", () => {
    const p = getStackProfile("ts-react-vite");
    expect(p).toBe(tsReactViteProfile);
  });

  it("listStackIds includes ts-react-vite alongside java-spring", () => {
    const ids = listStackIds();
    expect(ids).toContain("ts-react-vite");
    expect(ids).toContain("java-spring");
  });
});
