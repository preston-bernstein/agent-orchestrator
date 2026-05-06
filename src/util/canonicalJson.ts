/**
 * Recursive sort-keys + minimal whitespace JSON, byte-stable across runs.
 * - object keys sorted lexicographically at every level
 * - arrays preserve order
 * - undefined keys dropped (so callers can pass `{...x, hash: undefined}` to skip hash)
 */
export function canonicalize(obj: unknown): string {
  if (obj === undefined) return "null";
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(rec[k]))
      .join(",") +
    "}"
  );
}
