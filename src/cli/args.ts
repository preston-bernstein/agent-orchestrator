/**
 * Minimal CLI arg parser for `pnpm run orchestrate`. Recognized flags:
 *
 *   --spec <path>     spec file or directory (Phase 4 fixture mode = .md file)
 *   --dry-plan        plan-only; no supervisor spawn (A4 default)
 *   --execute         risky lane: route plan → supervisors (Phase 5+)
 *   --reason <text>   required when execute carries danger flag (Phase 7)
 *
 * Mutually exclusive flags throw `CliArgError`. Unknown flags are echoed
 * back in `unknown[]` so callers may decide policy.
 */

export interface ParsedArgs {
  spec?: string;
  dryPlan: boolean;
  execute: boolean;
  reason?: string;
  unknown: string[];
}

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliArgError";
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    dryPlan: false,
    execute: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-plan":
        out.dryPlan = true;
        break;
      case "--execute":
        out.execute = true;
        break;
      case "--spec": {
        const v = argv[i + 1];
        if (!v || v.startsWith("--")) {
          throw new CliArgError("--spec requires a path arg");
        }
        out.spec = v;
        i++;
        break;
      }
      case "--reason": {
        const v = argv[i + 1];
        if (!v || v.startsWith("--")) {
          throw new CliArgError("--reason requires a string arg");
        }
        out.reason = v;
        i++;
        break;
      }
      default:
        if (a !== undefined) out.unknown.push(a);
    }
  }
  if (process.env.ORCH_DRY_PLAN === "1") out.dryPlan = true;
  if (out.dryPlan && out.execute) {
    throw new CliArgError("--dry-plan and --execute are mutually exclusive");
  }
  return out;
}
