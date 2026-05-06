import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZERO_HASH, hashRecord, type AuditRecordT } from "./jsonl.js";

export type VerifyResult =
  | { valid: true; count: number }
  | { valid: false; brokenAt: number; reason: string };

/**
 * Replay the chain on disk:
 *  - line 0 must reference ZERO_HASH as its prev_hash
 *  - each subsequent line must reference the prior record's `hash`
 *  - each record's `hash` must match SHA-256 over canonical JSON sans `hash`
 *
 * Empty file → valid w/ count 0.
 */
function verifyChainRecord(
  line: string,
  index: number,
  prev: string,
):
  | { ok: true; nextPrev: string }
  | { ok: false; result: VerifyResult } {
  let rec: AuditRecordT;
  try {
    rec = JSON.parse(line) as AuditRecordT;
  } catch (e) {
    return {
      ok: false,
      result: {
        valid: false,
        brokenAt: index,
        reason: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  if (rec.prev_hash !== prev) {
    return {
      ok: false,
      result: { valid: false, brokenAt: index, reason: "prev_hash mismatch" },
    };
  }
  const recomputed = hashRecord(rec);
  if (recomputed !== rec.hash) {
    return {
      ok: false,
      result: { valid: false, brokenAt: index, reason: "hash mismatch" },
    };
  }
  return { ok: true, nextPrev: rec.hash };
}

export function verifyChain(path: string): VerifyResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return {
      valid: false,
      brokenAt: -1,
      reason: `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  let prev = ZERO_HASH;
  for (let i = 0; i < lines.length; i++) {
    const step = verifyChainRecord(lines[i] as string, i, prev);
    if (!step.ok) return step.result;
    prev = step.nextPrev;
  }
  return { valid: true, count: lines.length };
}

// ---------- CLI ----------

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

export function runCli(argv: readonly string[]): number {
  const target = argv[2];
  if (!target) {
    console.error("usage: audit:verify <path-to-audit.jsonl>");
    return 2;
  }
  const result = verifyChain(target);
  if (result.valid) {
    console.log(`chain valid (${result.count} records)`);
    return 0;
  }
  console.error(`BROKEN at record ${result.brokenAt}: ${result.reason}`);
  return 1;
}

if (isMain()) {
  process.exit(runCli(process.argv));
}
