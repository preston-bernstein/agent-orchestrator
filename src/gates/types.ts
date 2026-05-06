export type GateKind = "preflight" | "fast" | "heavy";

export interface GateExecResult {
  exit: number;
  stdout: string;
  stderr: string;
  oom?: boolean;
  timed_out?: boolean;
  duration_ms?: number;
}

export interface RunQualityDeps {
  exec?: (
    cmd: readonly string[],
    opts: { cwd: string; timeoutMs?: number; env?: Readonly<Record<string, string>> },
  ) => Promise<GateExecResult>;
}

export interface GateInvocation {
  cmd: readonly string[];
  cwd: string;
  exit: number;
  oom: boolean;
  timed_out: boolean;
  duration_ms: number;
  log_tail: string;
  kind: GateKind;
  stack: string;
}
