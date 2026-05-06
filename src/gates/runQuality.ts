import type { StackProfile } from "../stacks/types.js";
import type { GateInvocation, GateKind, RunQualityDeps } from "./types.js";

export type {
  GateExecResult,
  GateInvocation,
  GateKind,
  RunQualityDeps,
} from "./types.js";
import { defaultExec, mockExec, selectCmd } from "./runQualityExec.js";

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

interface RunQualityInput {
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

const DEFAULT_LOG_TAIL_LINES = 200;
function tailLines(s: string, n: number): string {
  if (!s) return "";
  const lines = s.split(/\r?\n/);
  if (lines.length <= n) return s;
  return lines.slice(lines.length - n).join("\n");
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

export { mockExec };
