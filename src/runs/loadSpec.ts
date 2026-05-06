import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SpecSnapshotT } from "./RunContext.js";

/**
 * Load a single spec into a `SpecSnapshot`. Phase 4 supports:
 *
 *   1. **Single .md fixture** — `--spec fixtures/no-op.md`. All three of
 *      `requirements_path` / `tasks_path` / `design_path` point at the same
 *      file (planner reads checkboxes only; O5 dry-run uses tasks_path).
 *      `fixtures/` is runtime-input fixtures; **not** the work-spec canon
 *      (`docs/specs/`).
 *   2. **Spec directory** — `--spec docs/specs/<slug>/`. Loads
 *      `requirements.md`, `tasks.md`, `design.md` from inside.
 *
 * `hash` is sha256 over canonical join of file bodies (edge 36 — frozen at
 * run start; resume verifies). `repo` defaults to `'agent-orchestrator'`
 * for in-repo fixtures; stacks Phase 5 will pull from spec frontmatter.
 */

interface LoadSpecOptions {
  /** override default `agent-orchestrator` for cross-repo specs. */
  repo?: SpecSnapshotT["repo"];
  /** override default `ts-node` stack for cross-repo specs. */
  stack?: SpecSnapshotT["stack"];
}

export async function loadSpec(
  specPath: string,
  opts: LoadSpecOptions = {},
): Promise<SpecSnapshotT> {
  const abs = path.resolve(specPath);
  const stats = await stat(abs);
  if (stats.isDirectory()) {
    return loadDirSpec(abs, opts);
  }
  return loadFileSpec(abs, opts);
}

async function loadFileSpec(
  abs: string,
  opts: LoadSpecOptions,
): Promise<SpecSnapshotT> {
  const body = await readFile(abs, "utf8");
  const slug = path.basename(abs, path.extname(abs));
  const hash = sha256(body);
  return {
    slug,
    repo: opts.repo ?? "agent-orchestrator",
    stack: opts.stack ?? "ts-node",
    requirements_path: abs,
    tasks_path: abs,
    design_path: abs,
    hash,
  };
}

async function loadDirSpec(
  abs: string,
  opts: LoadSpecOptions,
): Promise<SpecSnapshotT> {
  const requirements_path = path.join(abs, "requirements.md");
  const tasks_path = path.join(abs, "tasks.md");
  const design_path = path.join(abs, "design.md");
  const [r, t, d] = await Promise.all([
    readFile(requirements_path, "utf8"),
    readFile(tasks_path, "utf8"),
    readFile(design_path, "utf8"),
  ]);
  const hash = sha256(`${r}\n---\n${t}\n---\n${d}`);
  const slug = path.basename(abs);
  return {
    slug,
    repo: opts.repo ?? "agent-orchestrator",
    stack: opts.stack ?? "ts-node",
    requirements_path,
    tasks_path,
    design_path,
    hash,
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
