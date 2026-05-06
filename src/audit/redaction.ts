const SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /sk-[A-Za-z0-9]{20,}/g,
];

const REDACTED = "[REDACTED]";

export class RedactionFailure extends Error {
  constructor(
    public readonly leak: string,
    public readonly flagPath: string,
  ) {
    super(`redaction_failure: ${leak} (flag=${flagPath})`);
    this.name = "RedactionFailure";
  }
}

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

function findLiteralLeak(s: string, literals: readonly string[]): string | null {
  for (const lit of literals) {
    if (!lit) continue;
    if (s.includes(lit)) return `literal:${lit.slice(0, 4)}…`;
  }
  return null;
}

function findPatternLeak(s: string): string | null {
  for (const re of SECRET_PATTERNS) {
    const test = new RegExp(re.source, re.flags.replace("g", ""));
    if (test.test(s)) return `pattern:${re.source}`;
  }
  return null;
}

export function findLeak(s: string, literals: readonly string[] = []): string | null {
  return findLiteralLeak(s, literals) ?? findPatternLeak(s);
}

export function redactValue(v: unknown, literals: readonly string[]): unknown {
  if (typeof v === "string") return redactString(v, literals);
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, literals));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = redactValue(val, literals);
  }
  return out;
}

function scanLeakChildren(v: object, literals: readonly string[]): string | null {
  for (const val of Object.values(v as Record<string, unknown>)) {
    const hit = scanLeak(val, literals);
    if (hit) return hit;
  }
  return null;
}

export function scanLeak(v: unknown, literals: readonly string[]): string | null {
  if (typeof v === "string") return findLeak(v, literals);
  if (v === null || typeof v !== "object") return null;
  return scanLeakChildren(v, literals);
}
