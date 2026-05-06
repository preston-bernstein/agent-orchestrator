import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StackProfile } from "../stacks/types.js";
import type { GateExecResult, GateKind, RunQualityDeps } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type ExecErr = Error & {
  code?: number;
  signal?: string;
  stdout?: string;
  stderr?: string;
  killed?: boolean;
};

export function selectCmd(profile: StackProfile, kind: GateKind): readonly string[] {
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

function gateExecSuccess(stdout: string, stderr: string, startMs: number): GateExecResult {
  return {
    exit: 0,
    stdout,
    stderr,
    oom: /OutOfMemoryError/.test(stderr),
    duration_ms: Date.now() - startMs,
  };
}

function gateExecFromCaught(err: ExecErr, startMs: number): GateExecResult {
  const stderr = err.stderr ?? "";
  return {
    exit: typeof err.code === "number" ? err.code : 1,
    stdout: err.stdout ?? "",
    stderr,
    oom: /OutOfMemoryError/.test(stderr),
    timed_out: err.killed === true || err.signal === "SIGTERM",
    duration_ms: Date.now() - startMs,
  };
}

function mergeExecEnv(env?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return env ? { ...process.env, ...env } : process.env;
}

export async function defaultExec(
  cmd: readonly string[],
  opts: { cwd: string; timeoutMs?: number; env?: Readonly<Record<string, string>> },
): Promise<GateExecResult> {
  if (cmd.length === 0) {
    return { exit: 127, stdout: "", stderr: "empty cmd" };
  }
  const [program, ...args] = cmd as [string, ...string[]];
  const startMs = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: mergeExecEnv(opts.env),
      maxBuffer: 50 * 1024 * 1024,
    });
    return gateExecSuccess(stdout, stderr, startMs);
  } catch (e) {
    return gateExecFromCaught(e as ExecErr, startMs);
  }
}

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
