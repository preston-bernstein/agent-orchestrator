import { describe, expect, it } from "vitest";
import { loadBootConfig, requireTfConfig } from "../../src/config/env.js";

describe("loadBootConfig", () => {
  it("defaults RUNS_DIR + flags off when env empty", () => {
    const cfg = loadBootConfig({});
    expect(cfg.RUNS_DIR).toBe("./runs");
    expect(cfg.strictExpectations).toBe(false);
    expect(cfg.skipTfProbe).toBe(false);
    expect(cfg.TF_BASE_URL).toBeUndefined();
  });

  it("parses TF_SKIP_PROBE=1 + STRICT_EXPECTATIONS=true", () => {
    const cfg = loadBootConfig({
      TF_SKIP_PROBE: "1",
      STRICT_EXPECTATIONS: "true",
    });
    expect(cfg.skipTfProbe).toBe(true);
    expect(cfg.strictExpectations).toBe(true);
  });

  it("rejects malformed TF_BASE_URL", () => {
    expect(() => loadBootConfig({ TF_BASE_URL: "not-a-url" })).toThrow();
  });

  it("parses Inngest vars when present (I2 — optional)", () => {
    const cfg = loadBootConfig({
      INNGEST_EVENT_KEY: "ek_local",
      INNGEST_SIGNING_KEY: "signkey-XYZ",
      INNGEST_BASE_URL: "http://127.0.0.1:8288",
      INNGEST_DEV: "1",
    });
    expect(cfg.INNGEST_EVENT_KEY).toBe("ek_local");
    expect(cfg.INNGEST_SIGNING_KEY).toBe("signkey-XYZ");
    expect(cfg.INNGEST_BASE_URL).toBe("http://127.0.0.1:8288");
    expect(cfg.inngestDev).toBe(true);
  });

  it("Inngest vars absent ⇒ all undefined + dev=false (orchestrate path)", () => {
    const cfg = loadBootConfig({});
    expect(cfg.INNGEST_EVENT_KEY).toBeUndefined();
    expect(cfg.INNGEST_SIGNING_KEY).toBeUndefined();
    expect(cfg.INNGEST_BASE_URL).toBeUndefined();
    expect(cfg.inngestDev).toBe(false);
  });

  it("rejects malformed INNGEST_BASE_URL (loopback/LAN guard at z.url level)", () => {
    expect(() =>
      loadBootConfig({ INNGEST_BASE_URL: "not-a-url" }),
    ).toThrow();
  });
});

describe("requireTfConfig", () => {
  it("throws when TF_BASE_URL missing", () => {
    const cfg = loadBootConfig({ TF_API_KEY: "k" });
    expect(() => requireTfConfig(cfg)).toThrow(/TF_BASE_URL/);
  });

  it("throws when TF_API_KEY missing", () => {
    const cfg = loadBootConfig({ TF_BASE_URL: "https://tf.example.invalid" });
    expect(() => requireTfConfig(cfg)).toThrow(/TF_API_KEY/);
  });

  it("returns base+key when both present", () => {
    const cfg = loadBootConfig({
      TF_BASE_URL: "https://tf.example.invalid",
      TF_API_KEY: "tf-key-XYZ-1234",
    });
    const tf = requireTfConfig(cfg);
    expect(tf.baseUrl).toBe("https://tf.example.invalid");
    expect(tf.apiKey).toBe("tf-key-XYZ-1234");
  });
});
