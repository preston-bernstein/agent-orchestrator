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

function withInlineProtection(
  line: string,
  transform: (free: string) => string,
): string {
  const protectedTokens: string[] = [];
  const masked = line.replace(INLINE_PROTECT_RE, (match) => {
    protectedTokens.push(match);
    return `__CAVEMAN_P${protectedTokens.length - 1}__`;
  });
  const transformed = transform(masked);
  return transformed.replace(/__CAVEMAN_P(\d+)__/g, (_m, idx: string) => {
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

function classifyCompressLine(
  line: string,
  inFence: boolean,
): { entry: { line: string; isProtected: boolean }; nextInFence: boolean } {
  const fenceToggle = /^\s*```/.test(line);
  if (fenceToggle) {
    return { entry: { line, isProtected: true }, nextInFence: !inFence };
  }
  if (inFence || STACK_LINE_RE.test(line)) {
    return { entry: { line, isProtected: true }, nextInFence: inFence };
  }
  const transformed = withInlineProtection(line, (free) => stripFillers(free));
  const normalized = transformed.replace(/[ \t]+/g, " ").replace(/^ | $/g, "");
  return { entry: { line: normalized, isProtected: false }, nextInFence: inFence };
}

function nextBlankRunState(
  isProtected: boolean,
  line: string,
  blankRun: number,
): { emit: boolean; blankRun: number } {
  if (!isProtected && line === "") {
    const next = blankRun + 1;
    return { emit: next <= 1, blankRun: next };
  }
  return { emit: true, blankRun: 0 };
}

function collapseCompressedBlankRuns(
  processed: { line: string; isProtected: boolean }[],
): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const { line, isProtected } of processed) {
    const step = nextBlankRunState(isProtected, line, blankRun);
    blankRun = step.blankRun;
    if (!step.emit) continue;
    out.push(line);
  }
  return out;
}

export function compress(text: string): string {
  const lines = text.split("\n");
  const processed: { line: string; isProtected: boolean }[] = [];
  let inFence = false;
  for (const line of lines) {
    const { entry, nextInFence } = classifyCompressLine(line, inFence);
    processed.push(entry);
    inFence = nextInFence;
  }
  const out = collapseCompressedBlankRuns(processed);
  let joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
  joined = joined.replace(/^\n+/, "").replace(/\n+$/, "");
  return joined;
}
