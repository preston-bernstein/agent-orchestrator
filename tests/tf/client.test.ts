import { describe, expect, it, vi } from "vitest";
import {
  TfAuthError,
  TfClient,
  TfHostMismatchError,
  TfHttpError,
  TfNetworkError,
  type FetchLike,
} from "../../src/tf/client.js";

const BASE = "https://tf.example.invalid";
const KEY = "tf-key-XYZ-1234";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("TfClient hostname guard", () => {
  it("refuses absolute URL whose host ≠ base host (no fetch fired)", () => {
    const fetchSpy = vi.fn();
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: fetchSpy });
    expect(() => client.resolve("https://evil.example/v1/models")).toThrow(
      TfHostMismatchError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves relative paths against base", () => {
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: vi.fn() });
    expect(client.resolve("/v1/models").toString()).toBe(`${BASE}/v1/models`);
  });

  it("accepts absolute URL whose host matches base", () => {
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: vi.fn() });
    expect(client.resolve(`${BASE}/v1/foo`).toString()).toBe(`${BASE}/v1/foo`);
  });
});

describe("TfClient.request", () => {
  it("attaches Bearer auth header from apiKey", async () => {
    let captured: Headers | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    };
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await client.request("/v1/models");
    expect(captured?.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(captured?.get("accept")).toBe("application/json");
  });

  it("maps 401 to TfAuthError", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("nope", { status: 401 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.request("/v1/models")).rejects.toBeInstanceOf(TfAuthError);
  });

  it("maps 403 to TfAuthError", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("forbidden", { status: 403 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.request("/v1/models")).rejects.toBeInstanceOf(TfAuthError);
  });

  it("maps 500 to TfHttpError", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("boom", { status: 503 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.request("/v1/models")).rejects.toBeInstanceOf(TfHttpError);
  });

  it("wraps fetch rejection as TfNetworkError", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.request("/v1/models")).rejects.toBeInstanceOf(TfNetworkError);
  });
});

describe("TfClient.probe", () => {
  it("returns parsed model ids on 200", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ data: [{ id: "gpt-4o-mini" }, { id: "claude-3" }] });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    const res = await client.probe();
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(["gpt-4o-mini", "claude-3"]);
  });

  it("tolerates probe body without `data` array", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ shape: "unknown" });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    const res = await client.probe();
    expect(res.models).toEqual([]);
    expect(res.raw).toEqual({ shape: "unknown" });
  });

  it("auth error on probe propagates", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("401", { status: 401 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.probe()).rejects.toBeInstanceOf(TfAuthError);
  });

  // --- stryker kill tests (mutation gate) ---

  it("preserves caller-provided Authorization header (kills L120 conditional-true mutant)", async () => {
    let captured: Headers | undefined;
    const fetchImpl: FetchLike = async (_u, init) => {
      captured = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    };
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await client.request("/v1/models", {
      headers: { Authorization: "Bearer caller-token" },
    });
    expect(captured?.get("authorization")).toBe("Bearer caller-token");
  });

  it("preserves caller-provided Accept header (kills L123 conditional-true mutant)", async () => {
    let captured: Headers | undefined;
    const fetchImpl: FetchLike = async (_u, init) => {
      captured = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    };
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await client.request("/v1/models", {
      headers: { Accept: "text/plain" },
    });
    expect(captured?.get("accept")).toBe("text/plain");
  });

  it("status=500 specifically maps to TfHttpError (kills L144 `>= 500` → `> 500`)", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("internal", { status: 500 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.request("/v1/models")).rejects.toBeInstanceOf(TfHttpError);
  });

  it("probe on non-ok 404 throws TfHttpError (kills L158 `if (!res.ok)` → false)", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("not found", { status: 404 });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    await expect(client.probe()).rejects.toBeInstanceOf(TfHttpError);
  });

  it("probe with malformed JSON keeps raw === null (kills L162 catch arrow `null` → `undefined`)", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("not json {{{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    const res = await client.probe();
    expect(res.raw).toBeNull();
    expect(res.models).toEqual([]);
  });

  it("probe filters non-object entries in data array (kills L174 entry guard)", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ data: ["not-an-obj", null, { id: "valid-1" }, 42] });
    const client = new TfClient({ baseUrl: BASE, apiKey: KEY, fetchImpl });
    const res = await client.probe();
    expect(res.models).toEqual(["valid-1"]);
  });
});
