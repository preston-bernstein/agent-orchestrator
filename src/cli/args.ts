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

interface ParsedArgs {
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

const BOOL_CLI_FLAGS: Readonly<
  Record<string, keyof Pick<ParsedArgs, "dryPlan" | "execute" | "dangerApply">>
> = {
  "--dry-plan": "dryPlan",
  "--execute": "execute",
  "--danger-apply": "dangerApply",
};

function consumeNextArg(
  a: string,
  it: Iterator<string>,
  out: ParsedArgs,
): IteratorResult<string, undefined> {
  const boolField = BOOL_CLI_FLAGS[a];
  if (boolField) {
    out[boolField] = true;
    return it.next();
  }
  if (a === "--spec") {
    const tv = takeFlagValue(it, "--spec", "path");
    out.spec = tv.value;
    return tv.next;
  }
  if (a === "--reason") {
    const tv = takeFlagValue(it, "--reason", "string");
    out.reason = tv.value;
    return tv.next;
  }
  if (a !== undefined) out.unknown.push(a);
  return it.next();
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
    cur = consumeNextArg(cur.value as string, it, out);
  }
  if (process.env.ORCH_DRY_PLAN === "1") out.dryPlan = true;
  validateMutex(out);
  return out;
}
