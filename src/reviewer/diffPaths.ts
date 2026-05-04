/**
 * Minimal unified-diff helpers for deterministic reviewer + approval formatter.
 */

/** Repo-relative paths touched (`+++ b/<path>`); skips `/dev/null`. */
export function listUnifiedDiffRepoPaths(diffText: string): string[] {
  const paths = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const m = /^\+\+\+ ([^\t]+)/.exec(line);
    if (!m) continue;
    let p = m[1]?.trim() ?? "";
    if (p === "/dev/null") continue;
    if (p.startsWith("b/")) p = p.slice(2);
    if (p) paths.add(p);
  }
  return [...paths];
}

export interface DiffFileChurn {
  file: string;
  plus: number;
  minus: number;
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
    const hdr = /^\+\+\+ ([^\t]+)/.exec(line);
    if (hdr) {
      let p = hdr[1]?.trim() ?? "";
      if (p === "/dev/null") {
        current = null;
        continue;
      }
      if (p.startsWith("b/")) p = p.slice(2);
      current = p || null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff "))
      continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) bump(current, 1, 0);
    else if (line.startsWith("-")) bump(current, 0, 1);
  }

  return [...map.entries()].map(([file, v]) => ({
    file,
    plus: v.plus,
    minus: v.minus,
  }));
}
