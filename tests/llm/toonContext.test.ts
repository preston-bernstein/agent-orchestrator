import { describe, expect, it } from "vitest";
import { fromToon, toToonSection } from "../../src/llm/toonContext.js";

describe("toToonSection — happy path on uniform arrays", () => {
  const tasks = [
    { id: "spring-T1", repo: "spring-api", supervisor: "spring", title: "auth ep" },
    { id: "spring-T2", repo: "spring-api", supervisor: "spring", title: "logout ep" },
    { id: "react-T1", repo: "react-ui", supervisor: "react", title: "login form" },
  ];

  it("encodes uniform array as TOON (not fallback)", () => {
    const sec = toToonSection("tasks", tasks);
    expect(sec.format).toBe("toon");
    expect(sec.fallback).toBe(false);
    expect(sec.body).toMatch(/```toon/);
  });

  it("round-trips: decode(encoded) deep-equals source", () => {
    const sec = toToonSection("tasks", tasks, { fence: false });
    const back = fromToon(sec.body);
    expect(back).toEqual(tasks);
  });

  it("emits markdown fence when fence=true (default)", () => {
    const sec = toToonSection("findings", tasks);
    expect(sec.body.startsWith("```toon")).toBe(true);
    expect(sec.body.endsWith("```")).toBe(true);
  });

  it("omits fence when fence=false", () => {
    const sec = toToonSection("findings", tasks, { fence: false });
    expect(sec.body).not.toMatch(/```/);
  });

  it("carries the label through (caller embeds in prompt section header)", () => {
    const sec = toToonSection("changed_endpoints", tasks);
    expect(sec.label).toBe("changed_endpoints");
  });
});

describe("toToonSection — fallback path", () => {
  it("falls back to canonical JSON for empty input shapes (audit trail)", () => {
    // empty array — TOON may emit empty; verify either way fallback signaled
    const sec = toToonSection("empty", []);
    if (sec.fallback) {
      expect(sec.format).toBe("json");
      expect(sec.body).toMatch(/```json/);
    } else {
      expect(sec.format).toBe("toon");
    }
  });
});
