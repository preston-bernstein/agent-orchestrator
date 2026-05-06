/**
 * Minimal CLI arg parser for `pnpm run orchestrate`. Recognized flags:
 *
 *   --spec <path>     spec file or directory (Phase 4 fixture mode = .md file)
 *   --dry-plan        plan-only; no supervisor spawn (A4 default)
 *   --execute         risky lane: route plan → supervisors (Phase 5+)
 *   --reason <text>   required with --danger-apply (Phase 7 / C1)
 *   --danger-apply    irreversible lane; must pair with --execute + --reason
 *
 * Mutually exclusive flags throw `CliArgError`. Unknown flags are echoed
 * back in `unknown[]` so callers may decide policy.
 */

export interface ParsedArgs {
  spec?: string;
  dryPlan: boolean;
  execute: boolean;
  dangerApply: boolean;
  reason?: string;
  unknown: string[];
}

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgError";
  }
}

function takeFlagValue(
  it: Iterator<string>,
  flagName: string,
  kind: "path" | "string",
): { value: string; next: IteratorResult<string, undefined> } {
  const vNext = it.next();
  const v = vNext.done ? undefined : vNext.value;
  if (!v || v.startsWith("--")) {
    throw new CliArgError(`${flagName} requires a ${kind} arg`);
  }
  return { value: v, next: it.next() };
}

function validateMutex(out: ParsedArgs): void {
  if (out.dryPlan && out.execute) {
    throw new CliArgError("--dry-plan and --execute are mutually exclusive");
  }
  if (out.dryPlan && out.dangerApply) {
    throw new CliArgError("--danger-apply conflicts with dry-plan mode");
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    dryPlan: false,
    execute: false,
    dangerApply: false,
    unknown: [],
  };
  const it = argv[Symbol.iterator]();
  let cur = it.next();
  while (!cur.done) {
    const a = cur.value;
    switch (a) {
      case "--dry-plan":
        out.dryPlan = true;
        cur = it.next();
        break;
      case "--execute":
        out.execute = true;
        cur = it.next();
        break;
      case "--danger-apply":
        out.dangerApply = true;
        cur = it.next();
        break;
      case "--spec": {
        const tv = takeFlagValue(it, "--spec", "path");
        out.spec = tv.value;
        cur = tv.next;
        break;
      }
      case "--reason": {
        const tv = takeFlagValue(it, "--reason", "string");
        out.reason = tv.value;
        cur = tv.next;
        break;
      }
      default:
        if (a !== undefined) out.unknown.push(a);
        cur = it.next();
        break;
    }
  }
  if (process.env.ORCH_DRY_PLAN === "1") out.dryPlan = true;
  validateMutex(out);
  return out;
}
