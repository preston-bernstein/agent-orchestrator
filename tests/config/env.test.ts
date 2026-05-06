import { describe, expect, it } from "vitest";
import { loadBootConfig, requireTfConfig } from "../../src/config/env.js";

describe("loadBootConfig — defaults", () => {
  it("RUNS_DIR + flags off when env empty", () => {
    const cfg = loadBootConfig({});
    expect(cfg.RUNS_DIR).toBe("./runs");
    expect(cfg.strictExpectations).toBe(false);
    expect(cfg.skipTfProbe).toBe(false);
    expect(cfg.mockTf).toBe(false);
    expect(cfg.TF_BASE_URL).toBeUndefined();
  });
});

describe("loadBootConfig — MOCK_TF / probe / strict flags", () => {
  it("MOCK_TF=1|true enables mockTf (Inngest + offline planner mocks)", () => {
    expect(loadBootConfig({ MOCK_TF: "1" }).mockTf).toBe(true);
    expect(loadBootConfig({ MOCK_TF: "true" }).mockTf).toBe(true);
  });

  it("parses TF_SKIP_PROBE=1 + STRICT_EXPECTATIONS=true", () => {
    const cfg = loadBootConfig({
      TF_SKIP_PROBE: "1",
      STRICT_EXPECTATIONS: "true",
    });
    expect(cfg.skipTfProbe).toBe(true);
    expect(cfg.strictExpectations).toBe(true);
  });

  it("STRICT_EXPECTATIONS=1 also flips on (kills L25 first-comparison mutant)", () => {
    const cfg = loadBootConfig({ STRICT_EXPECTATIONS: "1" });
    expect(cfg.strictExpectations).toBe(true);
  });

  it("TF_SKIP_PROBE=true also flips on (kills L27 first-comparison mutant)", () => {
    const cfg = loadBootConfig({ TF_SKIP_PROBE: "true" });
    expect(cfg.skipTfProbe).toBe(true);
  });

  it("INNGEST_DEV=true flips on (kills L29 first-comparison mutant)", () => {
    const cfg = loadBootConfig({ INNGEST_DEV: "true" });
    expect(cfg.inngestDev).toBe(true);
  });

  it("EXPECTED_VAULT_SHA min/max length both enforced (kills L7 chained-min mutants)", () => {
    // min(7) — 6 chars rejected
    expect(() => loadBootConfig({ EXPECTED_VAULT_SHA: "abcdef" })).toThrow();
    // max(64) — 65 chars rejected (kills `min(7).min(64)` and `max(7)` mutants)
    expect(() =>
      loadBootConfig({ EXPECTED_VAULT_SHA: "a".repeat(65) }),
    ).toThrow();
    // 7-char sha accepted
    const ok = loadBootConfig({ EXPECTED_VAULT_SHA: "abcdef0" });
    expect(ok.EXPECTED_VAULT_SHA).toBe("abcdef0");
    // 40-char (typical) accepted
    const ok40 = loadBootConfig({ EXPECTED_VAULT_SHA: "a".repeat(40) });
    expect(ok40.EXPECTED_VAULT_SHA).toBe("a".repeat(40));
  });

  it("rejects malformed TF_BASE_URL", () => {
    expect(() => loadBootConfig({ TF_BASE_URL: "not-a-url" })).toThrow();
  });
});

describe("loadBootConfig — Inngest URL fields", () => {
  it("parses ORCH_ARTIFACT_BASE_URL when present", () => {
    const cfg = loadBootConfig({ ORCH_ARTIFACT_BASE_URL: "http://127.0.0.1:3030/" });
    expect(cfg.ORCH_ARTIFACT_BASE_URL).toMatch(/^http/);
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
