import { describe, expect, it } from "vitest";

describe("egress allowlist guard", () => {
  it("refuses globalThis.fetch from inside test code", async () => {
    await expect(
      globalThis.fetch("https://api.openai.com/v1/chat/completions"),
    ).rejects.toThrow(/egress refused/);
  });

  it("refuses URL objects too", async () => {
    await expect(
      globalThis.fetch(new URL("https://example.com/probe")),
    ).rejects.toThrow(/egress refused/);
  });
});
