/**
 * TrustFoundry client — minimal `fetch` wrapper for OpenAI-compatible
 * gateway. Egress is **pinned to `baseUrl.host`** (per requirements: "no
 * other host in egress"); any request whose URL hostname differs is
 * refused without hitting the network.
 *
 * Capability probe shape is unknown until TF endpoint docs land — we treat
 * `/v1/models` (OpenAI-compat) as the probe path and surface the parsed
 * body verbatim. Reviewers should re-confirm the path once finalized.
 */

import type { TfConfig } from "../config/env.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface TfClientOptions extends TfConfig {
  /** Injection seam for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
  /** Request timeout (ms). Default 10s. */
  timeoutMs?: number;
}

export interface TfProbeResult {
  ok: true;
  status: number;
  models: string[];
  raw: unknown;
}

// ---------- Errors ----------

export class TfHostMismatchError extends Error {
  constructor(
    public readonly expectedHost: string,
    public readonly gotHost: string,
  ) {
    super(`tf egress refused: ${gotHost} ≠ ${expectedHost}`);
    this.name = "TfHostMismatchError";
  }
}

export class TfAuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`tf auth error: ${status}`);
    this.name = "TfAuthError";
  }
}

export class TfHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`tf http error: ${status}`);
    this.name = "TfHttpError";
  }
}

export class TfNetworkError extends Error {
  constructor(
    public override readonly cause: unknown,
    message = "tf network error",
  ) {
    super(message);
    this.name = "TfNetworkError";
  }
}

// ---------- Client ----------

const DEFAULT_TIMEOUT_MS = 10_000;

export class TfClient {
  private readonly base: URL;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: TfClientOptions) {
    this.base = new URL(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Resolve a path or absolute URL against the pinned base. Rejects if the
   * resulting hostname doesn't match `baseUrl.host` — caller never gets a
   * chance to leak traffic to a non-TF host.
   */
  resolve(pathOrUrl: string): URL {
    // WHATWG URL: absolute URL inputs ignore `base` during parsing — one constructor suffices.
    const target = new URL(pathOrUrl, this.base);
    if (target.host !== this.base.host) {
      throw new TfHostMismatchError(this.base.host, target.host);
    }
    return target;
  }

  /**
   * Authenticated fetch. Adds `Authorization: Bearer …`, JSON `Accept`,
   * timeout, and the hostname guard. Returns the raw `Response` so callers
   * decide how to parse — error classification still happens here for
   * common shapes (auth / 5xx / network).
   */
  private buildAuthHeaders(init: RequestInit): Headers {
    const headers = new Headers(init.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return headers;
  }

  private async fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
    const headers = this.buildAuthHeaders(init);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers,
        signal: init.signal ?? controller.signal,
      });
    } catch (e) {
      throw new TfNetworkError(e);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async mapErrorStatuses(res: Response): Promise<Response> {
    if (res.status === 401 || res.status === 403) {
      const body = await safeText(res);
      throw new TfAuthError(res.status, body);
    }
    if (res.status >= 500) {
      const body = await safeText(res);
      throw new TfHttpError(res.status, body);
    }
    return res;
  }

  async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = this.resolve(pathOrUrl);
    const res = await this.fetchWithTimeout(url, init);
    return this.mapErrorStatuses(res);
  }

  /**
   * Capability probe — small GET against `/v1/models`. Returns parsed
   * `{ data: [{ id }] }` shape if present, else surfaces raw body. Any
   * non-2xx is mapped to a typed error by `request()` already.
   */
  async probe(): Promise<TfProbeResult> {
    const res = await this.request("/v1/models", { method: "GET" });
    if (!res.ok) {
      const body = await safeText(res);
      throw new TfHttpError(res.status, body);
    }
    const raw: unknown = await res.json().catch(() => null);
    const models = extractModelIds(raw);
    return { ok: true, status: res.status, models, raw };
  }
}

function modelIdFromListEntry(entry: unknown): string | undefined {
  if (entry == null || typeof entry !== "object") return undefined;
  const id = (entry as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function collectModelIdsFromArray(data: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of data) {
    const id = modelIdFromListEntry(entry);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function extractModelIds(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return collectModelIdsFromArray(data);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
