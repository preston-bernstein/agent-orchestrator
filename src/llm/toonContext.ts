import { decode, encode } from "@toon-format/toon";

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

export interface ToonOptions {
  /** Wrap output in markdown fence ` ```toon … ``` ` for model clarity. */
  fence?: boolean;
}

/**
 * Encode any value as a TOON section. Caller passes a label (like
 * `tasks` or `findings`); body is the encoded text. Falls back to
 * minified sorted-key JSON if TOON throws or produces empty output.
 */
export function toToonSection(
  label: string,
  value: unknown,
  opts: ToonOptions = {},
): ToonSection {
  const { fence = true } = opts;
  let body = "";
  let format: "toon" | "json" = "toon";
  let fallback = false;
  try {
    body = encode(value);
    if (!body || body.trim() === "") {
      throw new Error("toon_empty");
    }
  } catch {
    body = stableJson(value);
    format = "json";
    fallback = true;
  }
  if (fence) {
    body = format === "toon" ? "```toon\n" + body + "\n```" : "```json\n" + body + "\n```";
  }
  return { label, body, format, fallback };
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
  return canonicalJsonString(value);
}

function canonicalJsonString(obj: unknown): string {
  if (obj === undefined) return "null";
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJsonString).join(",") + "]";
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJsonString(rec[k]))
      .join(",") +
    "}"
  );
}
