import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";

export const ZERO_HASH = "0".repeat(64);

// ---------- Record schema ----------

export const AuditRecord = z.object({
  run_id: z.string(),
  step: z.string(),
  agent: z.string(),
  cmd: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  exit: z.number().optional(),
  truncated_log_path: z.string().optional(),
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  model: z.string().optional(),
  decisions: z.array(z.string()).optional(),
  timestamp: z.string(),

  prev_hash: z.string(),
  hash: z.string(),
});
export type AuditRecordT = z.infer<typeof AuditRecord>;

export type AuditRecordInput = Omit<AuditRecordT, "prev_hash" | "hash">;

// ---------- Canonical JSON ----------

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

// ---------- Secret redaction (edge 9) ----------

/**
 * Regex patterns for catch-all secret shapes. Real boot also passes literal
 * secrets (e.g. `process.env.TF_API_KEY`) so they get scrubbed verbatim too.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /sk-[A-Za-z0-9]{20,}/g,
];

const REDACTED = "[REDACTED]";

/** Strip literal secret strings + regex-matched shapes from `s`. */
export function redactString(s: string, literals: readonly string[] = []): string {
  let out = s;
  for (const lit of literals) {
    if (!lit) continue;
    out = out.split(lit).join(REDACTED);
  }
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** Returns first leak descriptor, or null if clean. */
export function findLeak(s: string, literals: readonly string[] = []): string | null {
  for (const lit of literals) {
    if (!lit) continue;
    if (s.includes(lit)) return `literal:${lit.slice(0, 4)}…`;
  }
  for (const re of SECRET_PATTERNS) {
    const test = new RegExp(re.source, re.flags.replace("g", ""));
    if (test.test(s)) return `pattern:${re.source}`;
  }
  return null;
}

/** Walk a value tree; redact every string in place by returning a new tree. */
function redactValue(v: unknown, literals: readonly string[]): unknown {
  if (typeof v === "string") return redactString(v, literals);
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, literals));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = redactValue(val, literals);
  }
  return out;
}

/** Walk a value tree; return first leak descriptor (or null). */
function scanLeak(v: unknown, literals: readonly string[]): string | null {
  if (typeof v === "string") return findLeak(v, literals);
  if (v === null || typeof v !== "object") return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = scanLeak(x, literals);
      if (hit) return hit;
    }
    return null;
  }
  for (const val of Object.values(v as Record<string, unknown>)) {
    const hit = scanLeak(val, literals);
    if (hit) return hit;
  }
  return null;
}

export class RedactionFailure extends Error {
  constructor(
    public readonly leak: string,
    public readonly flagPath: string,
  ) {
    super(`redaction_failure: ${leak} (flag=${flagPath})`);
    this.name = "RedactionFailure";
  }
}

// ---------- Hash chain ----------

/**
 * Hash a record minus its `hash` field. Canonical JSON ensures key-order
 * independence + cross-run byte stability.
 */
export function hashRecord(rec: Omit<AuditRecordT, "hash">): string {
  const input = canonicalize({ ...rec, hash: undefined });
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------- Writer ----------

export interface AuditWriterOptions {
  /** absolute path to runs/<id>/audit.jsonl */
  path: string;
  /** previous hash to chain from (default ZERO_HASH = first record) */
  prevHash?: string;
  /** literal secret strings to scrub + post-check (TF_API_KEY etc.) */
  secrets?: readonly string[];
  /**
   * Optional: post-check using a SECOND list of literals separate from the
   * scrub list. Defaults to `secrets`. Tests use this to force the failure
   * path (scrub list empty, post-check finds an unredacted literal).
   */
  postCheckLiterals?: readonly string[];
}

export class AuditWriter {
  private prevHash: string;
  private readonly path: string;
  private readonly secrets: readonly string[];
  private readonly postCheckLiterals: readonly string[];

  constructor(opts: AuditWriterOptions) {
    this.path = opts.path;
    this.prevHash = opts.prevHash ?? ZERO_HASH;
    this.secrets = opts.secrets ?? [];
    this.postCheckLiterals = opts.postCheckLiterals ?? this.secrets;
    mkdirSync(path.dirname(this.path), { recursive: true });
  }

  get currentPrevHash(): string {
    return this.prevHash;
  }

  /**
   * Append one record. Steps:
   *  1. Redact secrets in every string field.
   *  2. Re-scan; if leak → write redaction_failure.flag + throw.
   *  3. Compute SHA-256 over canonical JSON of (record sans `hash`).
   *  4. Append `JSON.stringify(final) + "\n"` to audit.jsonl.
   *  5. Advance prevHash.
   */
  write(input: AuditRecordInput): AuditRecordT {
    const redacted = redactValue(input, this.secrets) as AuditRecordInput;
    const leak = scanLeak(redacted, this.postCheckLiterals);
    if (leak) {
      const flagPath = path.join(path.dirname(this.path), "redaction_failure.flag");
      try {
        writeFileSync(
          flagPath,
          JSON.stringify(
            { leak, run_id: redacted.run_id, step: redacted.step, timestamp: redacted.timestamp },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      } catch {
        // best effort; fail-fast still surfaces the throw
      }
      throw new RedactionFailure(leak, flagPath);
    }

    const withPrev: Omit<AuditRecordT, "hash"> = {
      ...redacted,
      prev_hash: this.prevHash,
    };
    const hash = hashRecord(withPrev);
    const final: AuditRecordT = { ...withPrev, hash };
    appendFileSync(this.path, JSON.stringify(final) + "\n", "utf8");
    this.prevHash = hash;
    return final;
  }
}
