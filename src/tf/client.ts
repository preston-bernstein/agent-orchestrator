import type { TfConfig } from "../config/env.js";
import { extractModelIds, safeText } from "./clientHelpers.js";
import {
  TfAuthError,
  TfHostMismatchError,
  TfHttpError,
  TfNetworkError,
} from "./errors.js";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface TfClientOptions extends TfConfig {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface TfProbeResult {
  ok: true;
  status: number;
  models: string[];
  raw: unknown;
}

export { TfAuthError, TfHostMismatchError, TfHttpError, TfNetworkError };

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

  resolve(pathOrUrl: string): URL {
    const target = new URL(pathOrUrl, this.base);
    if (target.host !== this.base.host) {
      throw new TfHostMismatchError(this.base.host, target.host);
    }
    return target;
  }

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
