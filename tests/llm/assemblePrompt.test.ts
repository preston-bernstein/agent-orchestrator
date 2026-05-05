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

// --- stryker kill tests (mutation gate) ---

describe("assemblePrompt — env cap edge cases (kill mutants L124–126)", () => {
  it("ORCH_MAX_PROMPT_TOKENS=0 falls back to default (kills `<= 0` → `< 0`)", () => {
    process.env.ORCH_MAX_PROMPT_TOKENS = "0";
    const out = assemblePrompt({
      caveman: "small",
      basePrompt: "small",
      agentRole: "planner",
    });
    expect(out.estTokens).toBeGreaterThan(0); // reached completion w/ default cap, didn't throw at cap=0
  });

  it("ORCH_MAX_PROMPT_TOKENS=-5 falls back to default (kills `||` → `&&`)", () => {
    process.env.ORCH_MAX_PROMPT_TOKENS = "-5";
    expect(() =>
      assemblePrompt({
        caveman: "small",
        basePrompt: "small",
        agentRole: "planner",
      }),
    ).not.toThrow();
  });

  it("ORCH_MAX_PROMPT_TOKENS=abc (NaN) falls back to default", () => {
    process.env.ORCH_MAX_PROMPT_TOKENS = "abc";
    expect(() =>
      assemblePrompt({
        caveman: "small",
        basePrompt: "small",
        agentRole: "planner",
      }),
    ).not.toThrow();
  });
});

describe("assemblePrompt — section composition (kill mutants L135–148)", () => {
  it("sections array starts empty (kills L135 ArrayDeclaration sentinel)", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      agentRole: "planner",
    });
    expect(out.sections).toEqual(["C", "B"]);
    expect(out.sections).not.toContain("Stryker was here");
  });

  it("whitespace-only caveman is skipped (kills L136 conditional-true)", () => {
    const out = assemblePrompt({
      caveman: "   \n\t  ",
      basePrompt: "BASE",
      agentRole: "planner",
    });
    expect(out.sections).toEqual(["BASE"]);
    expect(out.text).toBe("BASE");
  });

  it("non-empty caveman is included (kills L136 conditional-false)", () => {
    const out = assemblePrompt({
      caveman: "CAVE",
      basePrompt: "BASE",
      agentRole: "planner",
    });
    expect(out.sections[0]).toBe("CAVE");
  });

  it("caveman is trimmed before push (kills L136 .trim() method-removal)", () => {
    const out = assemblePrompt({
      caveman: "   CAVE   ",
      basePrompt: "BASE",
      agentRole: "planner",
    });
    expect(out.sections[0]).toBe("CAVE");
  });

  it("toonSections=undefined ⇒ no throw, no toon section (kills L138 conditional-true)", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      agentRole: "planner",
    });
    expect(out.sections).toEqual(["C", "B"]);
  });

  it("xmlBlobs=undefined ⇒ no throw (kills L148 conditional-true)", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      agentRole: "planner",
    });
    expect(out.text).not.toMatch(/<[a-z_]+>/);
  });

  it("stackOverlay/taskContext/outputSchema absent ⇒ skipped (kills L145–154 method-removal)", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      agentRole: "planner",
    });
    // No stack/context/schema markers in output.
    expect(out.text).not.toContain("<output_schema>");
    expect(out.sections.length).toBe(2);
  });

  it("stackOverlay whitespace-only ⇒ skipped (kills L145 method-removal)", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      stackOverlay: "   ",
      agentRole: "planner",
    });
    expect(out.sections.length).toBe(2);
  });

  it("non-empty stackOverlay is trimmed and included", () => {
    const out = assemblePrompt({
      caveman: "C",
      basePrompt: "B",
      stackOverlay: "  STACK  ",
      agentRole: "planner",
    });
    expect(out.sections).toContain("STACK");
  });
});
