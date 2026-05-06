import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  findLeak,
  RedactionFailure,
  redactString,
  redactValue,
  scanLeak,
} from "./redaction.js";

export const ZERO_HASH = "0".repeat(64);

const _AuditRecordSchema = z.object({
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
export type AuditRecordT = z.infer<typeof _AuditRecordSchema>;

type AuditRecordInput = Omit<AuditRecordT, "prev_hash" | "hash">;

import { canonicalize } from "../util/canonicalJson.js";
export { canonicalize };

export { findLeak, RedactionFailure, redactString };

export function hashRecord(rec: Omit<AuditRecordT, "hash">): string {
  const input = canonicalize({ ...rec, hash: undefined });
  return createHash("sha256").update(input, "utf8").digest("hex");
}

interface AuditWriterOptions {
  path: string;
  prevHash?: string;
  secrets?: readonly string[];
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
        // best effort
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
