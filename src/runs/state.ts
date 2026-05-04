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
 */
export interface AtomicWriteOptions {
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
