import {
  RedactionFailure,
  findLeak,
  redactString,
} from "../audit/jsonl.js";

/**
 * Deterministic caveman compressor (no LLM). Runs before every Agent prompt
 * to bound token-spend on free-text fields flowing INTO model context. Vault
 * canon: `Build/Prompts/caveman-gate.md`. Pairs w/ O3 budgets + O8 hygiene
 * cap; never replaces audit redaction (jsonl.ts owns post-scan flag file).
 *
 * Pure function. Idempotent: caveman(caveman(x)) === caveman(x).
 */

export interface CavemanInput {
  text: string;
  /** soft cap; finalLen ≤ maxTokens * 4 chars (default 800 → ~3200 chars). */
  maxTokens?: number;
  /** literal secrets caller knows about (e.g. process.env.TF_API_KEY). */
  secrets?: readonly string[];
  /** truncation marker context (audit path / record id). */
  auditRef?: string;
}

export interface CavemanResult {
  text: string;
  originalLen: number;
  finalLen: number;
  truncated: boolean;
  redactionPasses: number;
}

const DEFAULT_MAX_TOKENS = 800;
const CHARS_PER_TOKEN = 4;

const FILLER_PATTERNS: readonly RegExp[] = [
  /\bplease\b/gi,
  /\bkindly\b/gi,
  /\bcould you\b/gi,
  /\bi would like\b/gi,
  /\bif possible\b/gi,
  /\bas we discussed\b/gi,
  /\bto be clear\b/gi,
  /\b(actually|basically|essentially)\b/gi,
];

const STACK_LINE_RE =
  /\b(?:Error|Exception)\b|\s+at\s+[\w$./<>]+\s*[(:]/;

const INLINE_PROTECT_RE = new RegExp(
  [
    "`[^`\\n]+`",
    "https?:\\/\\/\\S+",
    "\"[^\"\\n]*\"",
    "'[^'\\n]*'",
    "\\/[A-Za-z0-9_./\\-]+",
    "\\b[A-Za-z0-9_\\-]+\\.[A-Za-z]{1,8}\\b",
  ].join("|"),
  "g",
);

/**
 * Replace inline-protected tokens w/ placeholders, run transform, restore.
 * Placeholder format: `\u0000P<i>\u0000` (NUL-bracketed; cannot appear in
 * source text per JSON encoding).
 */
function withInlineProtection(
  line: string,
  transform: (free: string) => string,
): string {
  const protectedTokens: string[] = [];
  const masked = line.replace(INLINE_PROTECT_RE, (match) => {
    protectedTokens.push(match);
    return `\u0000P${protectedTokens.length - 1}\u0000`;
  });
  const transformed = transform(masked);
  // eslint-disable-next-line no-control-regex -- intentional NUL sentinel
  return transformed.replace(/\u0000P(\d+)\u0000/g, (_m, idx: string) => {
    const i = Number(idx);
    return protectedTokens[i] ?? "";
  });
}

function stripFillers(s: string): string {
  let out = s;
  for (const re of FILLER_PATTERNS) {
    out = out.replace(re, "");
  }
  return out;
}

/**
 * Walk lines; classify:
 *   - inside triple-backtick fence → verbatim
 *   - stack-trace line → verbatim
 *   - else → inline-protect, strip fillers, collapse intra-line whitespace
 *
 * Trailing whitespace + run-of-blank-line collapse runs only across **free**
 * lines (preserves protected indentation like `    at Foo.bar (...)`).
 */
function compress(text: string): string {
  const lines = text.split("\n");
  const processed: { line: string; isProtected: boolean }[] = [];
  let inFence = false;
  for (const line of lines) {
    const fenceToggle = /^\s*```/.test(line);
    if (fenceToggle) {
      processed.push({ line, isProtected: true });
      inFence = !inFence;
      continue;
    }
    if (inFence || STACK_LINE_RE.test(line)) {
      processed.push({ line, isProtected: true });
      continue;
    }
    const transformed = withInlineProtection(line, (free) => stripFillers(free));
    const normalized = transformed.replace(/[ \t]+/g, " ").replace(/^ | $/g, "");
    processed.push({ line: normalized, isProtected: false });
  }

  const out: string[] = [];
  let blankRun = 0;
  for (const { line, isProtected } of processed) {
    if (!isProtected && line === "") {
      blankRun++;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    out.push(line);
  }
  let joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
  joined = joined.replace(/^\n+/, "").replace(/\n+$/, "");
  return joined;
}

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

/**
 * Run secret scrubbing twice: first pass replaces literal + pattern matches,
 * post-pass scans for survivors. Any survivor → throw `RedactionFailure`.
 * Caveman gate has no flag file (audit writer owns that surface) — flagPath
 * sentinel string identifies the gate as origin.
 */
function redactOrFail(text: string, secrets: readonly string[]): {
  text: string;
  passes: number;
} {
  let passes = 0;
  let cur = text;
  for (let i = 0; i < 2; i++) {
    const next = redactString(cur, secrets);
    if (next !== cur) passes++;
    cur = next;
  }
  const leak = findLeak(cur, secrets);
  if (leak) {
    throw new RedactionFailure(leak, "<caveman-gate>");
  }
  return { text: cur, passes };
}

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
