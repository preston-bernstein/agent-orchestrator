import {
  RedactionFailure,
} from "../audit/jsonl.js";
import { compress } from "./cavemanCompress.js";
import { redactOrFail } from "./cavemanRedaction.js";

/**
 * Deterministic caveman compressor (no LLM). Runs before every Agent prompt
 * to bound token-spend on free-text fields flowing INTO model context. Vault
 * canon: `Build/Prompts/caveman-gate.md`. Pairs w/ O3 budgets + O8 hygiene
 * cap; never replaces audit redaction (jsonl.ts owns post-scan flag file).
 *
 * Pure function. Idempotent: caveman(caveman(x)) === caveman(x).
 */

interface CavemanInput {
  text: string;
  /** soft cap; finalLen ≤ maxTokens * 4 chars (default 800 → ~3200 chars). */
  maxTokens?: number;
  /** literal secrets caller knows about (e.g. process.env.TF_API_KEY). */
  secrets?: readonly string[];
  /** truncation marker context (audit path / record id). */
  auditRef?: string;
}

interface CavemanResult {
  text: string;
  originalLen: number;
  finalLen: number;
  truncated: boolean;
  redactionPasses: number;
}

const DEFAULT_MAX_TOKENS = 800;
const CHARS_PER_TOKEN = 4;


function applyLengthCap(
  text: string,
  maxChars: number,
  auditRef: string | undefined,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const ref = auditRef ?? "<audit-ref-unset>";
  const marker = ` … [truncated; full text in ${ref}]`;
  const head = text.slice(0, Math.max(0, maxChars - marker.length));
  return { text: head + marker, truncated: true };
}

export { RedactionFailure };

export function caveman(input: CavemanInput): CavemanResult {
  const { text, maxTokens = DEFAULT_MAX_TOKENS, secrets = [], auditRef } = input;
  const originalLen = text.length;

  const compressed = compress(text);
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const { text: capped, truncated } = applyLengthCap(compressed, maxChars, auditRef);
  const { text: scrubbed, passes } = redactOrFail(capped, secrets);

  return {
    text: scrubbed,
    originalLen,
    finalLen: scrubbed.length,
    truncated,
    redactionPasses: passes,
  };
}
