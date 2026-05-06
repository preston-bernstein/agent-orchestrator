import type { PathOwnership } from "./types.js";

export class PathOwnershipViolation extends Error {
  constructor(
    public readonly declared: string,
    public readonly ownerKey: string,
    public readonly allowed: readonly string[],
  ) {
    super(
      `path_ownership_map violation: '${declared}' not in allowed globs for ` +
        `'${ownerKey}' (allowed=${JSON.stringify(allowed)})`,
    );
    this.name = "PathOwnershipViolation";
  }
}

/**
 * Glob match for path-ownership check. Supports `**` (recursive segments) and
 * `*` (single segment). MVP is intentionally minimal.
 */
export function globMatch(declared: string, glob: string): boolean {
  const segs = glob.split("/");
  const reSegs: string[] = [];
  for (const s of segs) {
    if (s === "**") {
      reSegs.push(".+");
      continue;
    }
    const escaped = s
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");
    reSegs.push(escaped);
  }
  const re = new RegExp("^" + reSegs.join("/") + "$");
  return re.test(declared);
}

export function checkPathOwnership(
  declaredPaths: readonly string[],
  pathOwnership: PathOwnership,
  ownerKey: string,
): void {
  const allowed = pathOwnership[ownerKey] ?? [];
  for (const d of declaredPaths) {
    const ok = allowed.some((a) => globMatch(d, a));
    if (!ok) throw new PathOwnershipViolation(d, ownerKey, allowed);
  }
}
