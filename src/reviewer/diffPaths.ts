/**
 * Minimal unified-diff helpers for deterministic reviewer + approval formatter.
 */

function repoPathFromPlusPlusLine(line: string): string | null {
  const m = /^\+\+\+ ([^\t]+)/.exec(line);
  if (!m) return null;
  let p = m[1]?.trim() ?? "";
  if (p === "/dev/null") return null;
  if (p.startsWith("b/")) p = p.slice(2);
  return p || null;
}

/** Repo-relative paths touched (`+++ b/<path>`); skips `/dev/null`. */
export function listUnifiedDiffRepoPaths(diffText: string): string[] {
  const paths = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const p = repoPathFromPlusPlusLine(line);
    if (p) paths.add(p);
  }
  return [...paths];
}

interface DiffFileChurn {
  file: string;
  plus: number;
  minus: number;
}

function pathFromPlusPlusMatch(hdr: RegExpExecArray): string | null {
  let p = hdr[1]?.trim() ?? "";
  if (p === "/dev/null") return null;
  if (p.startsWith("b/")) p = p.slice(2);
  return p || null;
}

function isChurnMetaLine(line: string): boolean {
  return (
    line.startsWith("+++ ") ||
    line.startsWith("--- ") ||
    line.startsWith("diff ") ||
    line.startsWith("@@")
  );
}

function applyChurnDelta(
  line: string,
  current: string,
  bump: (f: string, deltaP: number, deltaM: number) => void,
): void {
  if (line.startsWith("+")) bump(current, 1, 0);
  else if (line.startsWith("-")) bump(current, 0, 1);
}

function applyChurnLine(
  line: string,
  current: string | null,
  bump: (f: string, deltaP: number, deltaM: number) => void,
): string | null {
  const hdr = /^\+\+\+ ([^\t]+)/.exec(line);
  if (hdr) return pathFromPlusPlusMatch(hdr);
  if (!current) return current;
  if (isChurnMetaLine(line)) return current;
  applyChurnDelta(line, current, bump);
  return current;
}

/** Per-file +/- line counts (excluding headers `+++`, `---`, `@@`). */
export function diffChurnByFile(diffText: string): DiffFileChurn[] {
  const lines = diffText.split(/\r?\n/);
  let current: string | null = null;
  const map = new Map<string, { plus: number; minus: number }>();

  const bump = (f: string, deltaP: number, deltaM: number) => {
    const cur = map.get(f) ?? { plus: 0, minus: 0 };
    cur.plus += deltaP;
    cur.minus += deltaM;
    map.set(f, cur);
  };

  for (const line of lines) {
    current = applyChurnLine(line, current, bump);
  }

  return [...map.entries()].map(([file, v]) => ({
    file,
    plus: v.plus,
    minus: v.minus,
  }));
}
