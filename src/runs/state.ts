import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomic state writer for runs/<id>/state.json (edge 44).
 *
 * Strategy: write to sibling tmp file w/ unique suffix, fsync, then `rename`
 * onto target. POSIX rename = atomic on same filesystem; partial writes never
 * leave a torn target file readable by a concurrent resume attempt.
 *
 * **Scope (task 46 / Inngest absorption):** this writer is the durability path
 * for the **local mock CLI only** (`src/cli/orchestrate.ts` + workflow tests).
 * The Inngest path owns durability via `step.run('persist-*', …)` + replay
 * safety via the TF idempotency cache (`src/tf/cache.ts`, task 40); resume is
 * re-emit-event-with-same-id (task 45), not a tmp→rename roundtrip. Plan §I4
 * forbids nested `inngest.send()` from inside Mastra subgraphs — the same
 * single-writer constraint applies here: keep this writer outside `step.run`
 * boundaries the Inngest function already manages.
 */
interface AtomicWriteOptions {
  /** absolute target path (e.g. runs/<id>/state.json) */
  path: string;
  /** payload to serialize w/ JSON.stringify(.., null, 2) */
  data: unknown;
  /** if true, call fsync before rename (default true). */
  fsync?: boolean;
}

export function atomicWriteJson(opts: AtomicWriteOptions): void {
  const { path: target, data, fsync = true } = opts;
  const dir = path.dirname(target);
  mkdirSync(dir, { recursive: true });
  const suffix = randomBytes(6).toString("hex");
  const tmp = path.join(dir, `.${path.basename(target)}.${suffix}.tmp`);
  const body = JSON.stringify(data, null, 2);
  if (fsync) {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, body, 0, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } else {
    writeFileSync(tmp, body, "utf8");
  }
  try {
    renameSync(tmp, target);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore — surface original error
    }
    throw e;
  }
}

export function readJson<T = unknown>(target: string): T {
  return JSON.parse(readFileSync(target, "utf8")) as T;
}
