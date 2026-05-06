import { CliArgError } from "../errors/CliArgError.js";

export { CliArgError };

/**
 * Minimal CLI arg parser for `pnpm run orchestrate`. Recognized flags:
 *
 *   --spec <path>     spec file or directory (fixture mode = .md file)
 *   --dry-plan        plan-only; no supervisor spawn (A4 default)
 *   --execute         route plan → supervisors
 *   --reason <text>   required with --danger-apply (C1)
 *   --danger-apply    irreversible lane; must pair with --execute + --reason
 *   --follow          after send, poll run status until terminal
 *   --wait-approval    when paused, poll approval decisions and continue
 *   --approval-timeout-ms <n> timeout window for wait-approval polling
 *   --gates-verify     send orch/gates.verify (managed-repo quality gates only, no planner/LLM)
 *
 * Mutually exclusive flags throw `CliArgError`. Unknown flags are echoed
 * back in `unknown[]` so callers may decide policy.
 */

export interface ParsedArgs {
  spec?: string;
  dryPlan: boolean;
  execute: boolean;
  gatesVerify: boolean;
  dangerApply: boolean;
  follow: boolean;
  waitApproval: boolean;
  approvalTimeoutMs?: number;
  reason?: string;
  unknown: string[];
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

function validateGatesMutex(out: ParsedArgs): void {
  if (!out.gatesVerify) return;
  if (out.execute) throw new CliArgError("--gates-verify conflicts with --execute");
  if (out.dryPlan) throw new CliArgError("--gates-verify conflicts with --dry-plan / ORCH_DRY_PLAN");
  if (out.waitApproval) throw new CliArgError("--gates-verify does not pair with --wait-approval");
}

function validateDryExecuteMutex(out: ParsedArgs): void {
  if (out.dryPlan && out.execute) {
    throw new CliArgError("--dry-plan and --execute are mutually exclusive");
  }
  if (out.dryPlan && out.dangerApply) {
    throw new CliArgError("--danger-apply conflicts with dry-plan mode");
  }
}

function validateMutex(out: ParsedArgs): void {
  validateGatesMutex(out);
  validateDryExecuteMutex(out);
}

const BOOL_CLI_FLAGS: Readonly<
  Record<
    string,
    keyof Pick<
      ParsedArgs,
      | "dryPlan"
      | "execute"
      | "gatesVerify"
      | "dangerApply"
      | "follow"
      | "waitApproval"
    >
  >
> = {
  "--dry-plan": "dryPlan",
  "--execute": "execute",
  "--gates-verify": "gatesVerify",
  "--danger-apply": "dangerApply",
  "--follow": "follow",
  "--wait-approval": "waitApproval",
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
  if (a === "--approval-timeout-ms") {
    const tv = takeFlagValue(it, "--approval-timeout-ms", "string");
    const n = Number(tv.value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new CliArgError("--approval-timeout-ms must be a positive number");
    }
    out.approvalTimeoutMs = Math.floor(n);
    return tv.next;
  }
  if (a !== undefined) out.unknown.push(a);
  return it.next();
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    dryPlan: false,
    execute: false,
    gatesVerify: false,
    dangerApply: false,
    follow: false,
    waitApproval: false,
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
