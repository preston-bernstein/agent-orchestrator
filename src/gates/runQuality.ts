import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StackProfile } from "../stacks/types.js";

/**
 * `runQuality` — quality-gate dispatch by `StackProfile`. Vault canon:
 * `Build/Patterns/O5-planner-dry-run.md` references the gate command;
 * stack overlay defines the actual argv. This module is the single
 * subprocess seam — supervisors NEVER call `execFile` directly.
 *
 * Edge contracts:
 *   - **edge 3** — log truncation: stdout/stderr trimmed to last
 *     `LOG_TAIL_LINES` lines (default 200) before audit. Full log path
 *     returned via `truncated_log_path` only when caller persists it.
 *   - **edge 19** — OOM detect: `OutOfMemoryError` substring in stderr
 *     ⇒ `oom: true`.
 *   - **edge 3** — timeout: `timed_out: true` if exec aborted by signal.
 *
 * Exec is injected via `deps.exec` so unit tests + Scenario A run w/ zero
 * `child_process` calls (Phase 5 Scenario A is offline; real `mvn` runs
 * land at Phase 5+ E2E w/ a real spring-api repo).
 */

const execFileAsync = promisify(execFile);

export type GateKind = "preflight" | "fast" | "heavy";

export interface GateExecResult {
  exit: number;
  stdout: string;
  stderr: string;
  oom?: boolean;
  timed_out?: boolean;
  duration_ms?: number;
}

export interface RunQualityInput {
  profile: StackProfile;
  cwd: string;
  kind: GateKind;
  /** Hard timeout in ms; surface as `timed_out: true`. */
  timeoutMs?: number;
  /** Override max log-tail lines (default 200, edge 3). */
  logTailLines?: number;
  /** Pass through env (orchestrator may inject `MAVEN_OPTS=-Xmx2g` per overlay). */
  env?: Readonly<Record<string, string>>;
}

export interface RunQualityDeps {
  /**
   * Injection seam: subprocess runner. Tests pass a fake; real lane
   * uses `defaultExec` (built on `node:child_process.execFile`).
   */
  exec?: (
    cmd: readonly string[],
    opts: { cwd: string; timeoutMs?: number; env?: Readonly<Record<string, string>> },
  ) => Promise<GateExecResult>;
}

export interface GateInvocation {
  /** Argv (program + args). Stack profile decides; `runQuality` just dispatches. */
  cmd: readonly string[];
  cwd: string;
  exit: number;
  oom: boolean;
  timed_out: boolean;
  duration_ms: number;
  /** Last `logTailLines` of merged stdout+stderr (edge 3). */
  log_tail: string;
  kind: GateKind;
  /** Mirror of profile id for audit ergonomics. */
  stack: string;
}

const DEFAULT_LOG_TAIL_LINES = 200;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function selectCmd(profile: StackProfile, kind: GateKind): readonly string[] {
  switch (kind) {
    case "preflight":
      return profile.preflightCmd;
    case "fast":
      return profile.qualityFastCmd;
    case "heavy":
      return profile.qualityHeavyCmd;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unreachable gate kind: ${String(exhaustive)}`);
    }
  }
}

function tailLines(s: string, n: number): string {
  if (!s) return "";
  const lines = s.split(/\r?\n/);
  if (lines.length <= n) return s;
  return lines.slice(lines.length - n).join("\n");
}

/**
 * Default exec — `child_process.execFile` w/ timeout + OOM substring scan.
 * Production lane only; tests inject `deps.exec`.
 */
async function defaultExec(
  cmd: readonly string[],
  opts: {
    cwd: string;
    timeoutMs?: number;
    env?: Readonly<Record<string, string>>;
  },
): Promise<GateExecResult> {
  if (cmd.length === 0) {
    return { exit: 127, stdout: "", stderr: "empty cmd" };
  }
  const [program, ...args] = cmd as [string, ...string[]];
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
    return {
      exit: 0,
      stdout,
      stderr,
      oom: /OutOfMemoryError/.test(stderr),
      duration_ms: Date.now() - start,
    };
  } catch (e) {
    type ExecErr = Error & {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    const err = e as ExecErr;
    const stderr = err.stderr ?? "";
    return {
      exit: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr,
      oom: /OutOfMemoryError/.test(stderr),
      timed_out: err.killed === true || err.signal === "SIGTERM",
      duration_ms: Date.now() - start,
    };
  }
}

export async function runQuality(
  input: RunQualityInput,
  deps: RunQualityDeps = {},
): Promise<GateInvocation> {
  const exec = deps.exec ?? defaultExec;
  const cmd = selectCmd(input.profile, input.kind);
  const logCap = input.logTailLines ?? DEFAULT_LOG_TAIL_LINES;
  const start = Date.now();
  const optsEnv = input.env ? { env: input.env } : {};
  const optsTimeout = input.timeoutMs !== undefined
    ? { timeoutMs: input.timeoutMs }
    : {};
  const result = await exec(cmd, {
    cwd: input.cwd,
    ...optsTimeout,
    ...optsEnv,
  });
  const merged = `${result.stdout}\n${result.stderr}`;
  return {
    cmd,
    cwd: input.cwd,
    exit: result.exit,
    oom: result.oom === true,
    timed_out: result.timed_out === true,
    duration_ms: result.duration_ms ?? Date.now() - start,
    log_tail: tailLines(merged, logCap),
    kind: input.kind,
    stack: input.profile.id,
  };
}

/**
 * Mock exec for unit + Scenario A tests. Caller passes `exit` + optional
 * `stderr` body (e.g. inject `OutOfMemoryError` for edge 19 test). Returns
 * a deterministic `GateExecResult` shape.
 */
export function mockExec(opts: {
  exit: number;
  stdout?: string;
  stderr?: string;
  oom?: boolean;
  timed_out?: boolean;
  duration_ms?: number;
}): RunQualityDeps["exec"] {
  return async () => ({
    exit: opts.exit,
    stdout: opts.stdout ?? "",
    stderr: opts.stderr ?? "",
    ...(opts.oom !== undefined ? { oom: opts.oom } : {}),
    ...(opts.timed_out !== undefined ? { timed_out: opts.timed_out } : {}),
    ...(opts.duration_ms !== undefined ? { duration_ms: opts.duration_ms } : {}),
  });
}
