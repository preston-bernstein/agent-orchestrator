import { afterEach, describe, expect, it } from "vitest";
import {
  PathOwnershipViolation,
  PromptBudgetError,
  assemblePrompt,
  estimateTokens,
  globMatch,
} from "../../src/llm/assemblePrompt.js";
import { toToonSection } from "../../src/llm/toonContext.js";

const ORIG_ENV = process.env.ORCH_MAX_PROMPT_TOKENS;

afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.ORCH_MAX_PROMPT_TOKENS;
  else process.env.ORCH_MAX_PROMPT_TOKENS = ORIG_ENV;
});

describe("globMatch — minimal MVP", () => {
  it("exact path = exact glob", () => {
    expect(globMatch("src/main/java/Foo.java", "src/main/java/Foo.java")).toBe(true);
  });

  it("** matches recursive segments", () => {
    expect(globMatch("src/main/java/foo/bar/Baz.java", "src/main/java/**")).toBe(true);
    expect(globMatch("src/main/java/foo/Baz.java", "src/main/java/**")).toBe(true);
  });

  it("* matches single segment", () => {
    expect(globMatch("src/Foo.java", "src/*.java")).toBe(true);
    expect(globMatch("src/sub/Foo.java", "src/*.java")).toBe(false);
  });

  it("rejects unrelated path", () => {
    expect(globMatch("react-ui/src/App.tsx", "src/main/java/**")).toBe(false);
  });
});

describe("assemblePrompt — path_ownership_map allowlist (SF4 task 30)", () => {
  const baseOk = {
    caveman: "task: add login endpoint",
    basePrompt: "you are planner. emit plan.",
    agentRole: "planner",
  };

  it("accepts when every declaredPaths matches an allowed glob", () => {
    const out = assemblePrompt({
      ...baseOk,
      declaredPaths: ["src/main/java/foo/Bar.java"],
      pathOwnership: { "spring-T1": ["src/main/java/**"] },
      ownerKey: "spring-T1",
    });
    expect(out.text).toContain("you are planner");
  });

  it("throws PathOwnershipViolation when path not in allowed globs", () => {
    expect(() =>
      assemblePrompt({
        ...baseOk,
        declaredPaths: ["react-ui/src/App.tsx"],
        pathOwnership: { "spring-T1": ["src/main/java/**"] },
        ownerKey: "spring-T1",
      }),
    ).toThrow(PathOwnershipViolation);
  });

  it("skips check when ownerKey absent (caller opted out)", () => {
    const out = assemblePrompt({
      ...baseOk,
      declaredPaths: ["any/path/here.ts"],
    });
    expect(out.estTokens).toBeGreaterThan(0);
  });

  it("empty allowed globs => any declaredPath is rejected", () => {
    expect(() =>
      assemblePrompt({
        ...baseOk,
        declaredPaths: ["src/Foo.ts"],
        pathOwnership: { "spring-T1": [] },
        ownerKey: "spring-T1",
      }),
    ).toThrow(PathOwnershipViolation);
  });
});

describe("assemblePrompt — O8 prompt budget cap", () => {
  it("refuses w/ PromptBudgetError when est > maxPromptTokens", () => {
    const huge = "x".repeat(100);
    expect(() =>
      assemblePrompt({
        caveman: huge,
        basePrompt: huge,
        agentRole: "planner",
        maxPromptTokens: 5,
      }),
    ).toThrow(PromptBudgetError);
  });

  it("respects ORCH_MAX_PROMPT_TOKENS env override", () => {
    process.env.ORCH_MAX_PROMPT_TOKENS = "5";
    const huge = "x".repeat(100);
    expect(() =>
      assemblePrompt({
        caveman: huge,
        basePrompt: huge,
        agentRole: "planner",
      }),
    ).toThrow(PromptBudgetError);
  });

  it("falls back to default 100k when env unset / invalid", () => {
    delete process.env.ORCH_MAX_PROMPT_TOKENS;
    const out = assemblePrompt({
      caveman: "small",
      basePrompt: "small",
      agentRole: "planner",
    });
    expect(out.estTokens).toBeLessThan(100_000);
  });
});

describe("assemblePrompt — assembly order matches Build/Prompts/Index §Prompt assembly", () => {
  it("section order: caveman → toon → base → stack → context → xml → schema", () => {
    const tasksToon = toToonSection(
      "tasks",
      [
        { id: "T1", title: "x" },
        { id: "T2", title: "y" },
      ],
      { fence: false },
    );
    const out = assemblePrompt({
      caveman: "<<CAVEMAN>>",
      toonSections: [tasksToon],
      basePrompt: "<<BASE>>",
      stackOverlay: "<<STACK>>",
      taskContext: "<<CONTEXT>>",
      xmlBlobs: [{ tag: "spec_excerpt", body: "<<SPEC>>" }],
      outputSchema: "<<SCHEMA>>",
      agentRole: "planner",
    });
    const idx = (s: string) => out.text.indexOf(s);
    expect(idx("<<CAVEMAN>>")).toBeLessThan(idx("<<BASE>>"));
    expect(idx("<<BASE>>")).toBeLessThan(idx("<<STACK>>"));
    expect(idx("<<STACK>>")).toBeLessThan(idx("<<CONTEXT>>"));
    expect(idx("<<CONTEXT>>")).toBeLessThan(idx("<spec_excerpt>"));
    expect(idx("<spec_excerpt>")).toBeLessThan(idx("<output_schema>"));
    expect(out.text).toContain("### tasks\n");
    expect(out.text).toContain("<output_schema>\n<<SCHEMA>>\n</output_schema>");
  });
});

describe("estimateTokens", () => {
  it("Math.ceil(chars / 4) — MVP fallback per O8", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
