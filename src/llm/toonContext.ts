import { decode, encode } from "@toon-format/toon";
import { canonicalize } from "../util/canonicalJson.js";

/**
 * O6 — TOON-encode chosen RunContext / step output slices for LLM input.
 * In memory + audit + on-disk: stay JSON. Only at assembled prompt boundary
 * may a slice be re-encoded as TOON to shrink token width on uniform arrays.
 *
 * Vault canon: `Build/Patterns/O6-toon-llm-boundary.md`. Audit lines stay
 * JSON regardless. TOON failures fall back to minified canonical JSON +
 * audit trail flag (`toon_fallback: true`).
 */

export interface ToonSection {
  label: string;
  body: string;
  format: "toon" | "json";
  fallback: boolean;
}

interface ToonOptions {
  /** Wrap output in markdown fence ` ```toon … ``` ` for model clarity. */
  fence?: boolean;
}

/**
 * Encode any value as a TOON section. Caller passes a label (like
 * `tasks` or `findings`); body is the encoded text. Falls back to
 * minified sorted-key JSON if TOON throws or produces empty output.
 */
function encodeToonOrJsonFallback(value: unknown): {
  body: string;
  format: "toon" | "json";
  fallback: boolean;
} {
  try {
    const encoded = encode(value);
    if (!encoded || encoded.trim() === "") throw new Error("toon_empty");
    return { body: encoded, format: "toon", fallback: false };
  } catch {
    return { body: stableJson(value), format: "json", fallback: true };
  }
}

function applyMarkdownFence(
  body: string,
  format: "toon" | "json",
  fence: boolean,
): string {
  if (!fence) return body;
  const lang = format === "toon" ? "toon" : "json";
  return "```" + lang + "\n" + body + "\n```";
}

export function toToonSection(
  label: string,
  value: unknown,
  opts: ToonOptions = {},
): ToonSection {
  const { fence = true } = opts;
  const encoded = encodeToonOrJsonFallback(value);
  const body = applyMarkdownFence(encoded.body, encoded.format, fence);
  return {
    label,
    body,
    format: encoded.format,
    fallback: encoded.fallback,
  };
}

/**
 * Decode a TOON-encoded body back to a JS value. Round-trip helper used in
 * tests; not used at runtime (model emits structured JSON, not TOON).
 */
export function fromToon<T = unknown>(body: string): T {
  return decode(body) as T;
}

/** Stable minified JSON w/ sorted keys (canonical) — fallback path. */
function stableJson(value: unknown): string {
  return canonicalize(value);
}
