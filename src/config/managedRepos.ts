import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  getStackProfile,
  UnknownStackError,
  type StackProfile,
} from "../stacks/index.js";

/**
 * Managed-repo registry. Phase 5 closeout — bridges:
 *
 *   `ORCH_MANAGED_REPOS=spring-api:/abs/path,react-ui:/abs/path` (env)
 *     ↓
 *   `<repo>/_meta.md` frontmatter (vault canon: stack, restricted_paths,
 *   contract.spec_path) parsed at boot
 *     ↓
 *   `runSupervisorBranch({ cwds: { spring: …, react: … } })` keyed by
 *   supervisor id.
 *
 * Vault canon refs:
 *   - `Build/RepoKits/<repo>/_meta.md.example` — frontmatter shape
 *   - `Build/Prompts/Stacks/<id>.md` — overlay declares profile fields
 *
 * Read-on-boot, cached in returned `ManagedRepoMap` — zero per-task FS hits.
 *
 * **Refusal points (boot-time, before any LLM):**
 *   - Env mapping malformed → `ManagedRepoEnvError`
 *   - `_meta.md` missing on any registered path → `ManagedRepoMetaMissing`
 *   - `_meta.md` declares unknown stack id → `UnknownStackError` (rethrown)
 *   - `_meta.md` declares stack mismatching declared expectation (rare) →
 *     same path-violation surface caller decides.
 */

export type RepoId = "spring-api" | "react-ui" | "agent-orchestrator";
export type SupervisorId = "spring" | "react" | "orch";

const REPO_TO_SUPERVISOR: Readonly<Record<RepoId, SupervisorId>> = {
  "spring-api": "spring",
  "react-ui": "react",
  "agent-orchestrator": "orch",
};

const SUPERVISOR_TO_REPO: Readonly<Record<SupervisorId, RepoId>> = {
  spring: "spring-api",
  react: "react-ui",
  orch: "agent-orchestrator",
};

export function supervisorIdForRepo(repo: RepoId): SupervisorId {
  return REPO_TO_SUPERVISOR[repo];
}

export function repoIdForSupervisor(sup: SupervisorId): RepoId {
  return SUPERVISOR_TO_REPO[sup];
}

// ---------- _meta.md schema ----------

const RepoMetaSchema = z.object({
  stack: z.string(),
  package_manager: z.string().optional(),
  language_version: z.union([z.string(), z.number()]).optional(),
  codegen_paths: z.array(z.string()).default([]),
  generated_markers: z.array(z.string()).default([]),
  contract: z
    .object({
      format: z.string().optional(),
      spec_path: z.string().optional(),
    })
    .optional(),
  restricted_paths: z.array(z.string()).default([]),
  owners: z.array(z.string()).default([]),
});
export type RepoMetaT = z.infer<typeof RepoMetaSchema>;

// ---------- Errors ----------

export class ManagedRepoEnvError extends Error {
  constructor(public readonly raw: string, reason: string) {
    super(`ORCH_MANAGED_REPOS malformed: ${reason} (raw='${raw}')`);
    this.name = "ManagedRepoEnvError";
  }
}

export class ManagedRepoMetaMissing extends Error {
  constructor(public readonly repoId: string, public readonly metaPath: string) {
    super(
      `managed repo '${repoId}' is missing _meta.md at ${metaPath} ` +
        `(copy from vault Build/RepoKits/<repo>/_meta.md.example)`,
    );
    this.name = "ManagedRepoMetaMissing";
  }
}

export class ManagedRepoMetaInvalid extends Error {
  constructor(
    public readonly repoId: string,
    public readonly metaPath: string,
    public readonly issues: unknown,
  ) {
    super(
      `managed repo '${repoId}' _meta.md failed validation at ${metaPath}`,
    );
    this.name = "ManagedRepoMetaInvalid";
  }
}

// ---------- Frontmatter parser ----------

interface FrontMatterSplit {
  yaml: string;
  body: string;
}

function splitFrontMatter(raw: string): FrontMatterSplit {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { yaml: "", body: raw };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { yaml: "", body: raw };
  return {
    yaml: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

type PendingKind = "unknown" | "array" | "object";

interface MetaParseCtx {
  out: Record<string, unknown>;
  pendingKey: string | null;
  pendingKind: PendingKind;
  pendingArray: string[];
  pendingObject: Record<string, string>;
}

function flushMetaPending(ctx: MetaParseCtx): void {
  if (!ctx.pendingKey) return;
  if (ctx.pendingKind === "object") {
    ctx.out[ctx.pendingKey] = ctx.pendingObject;
  } else {
    ctx.out[ctx.pendingKey] = ctx.pendingArray;
  }
  ctx.pendingKey = null;
  ctx.pendingKind = "unknown";
  ctx.pendingArray = [];
  ctx.pendingObject = {};
}

function tryConsumeMetaArrayLine(line: string, ctx: MetaParseCtx): boolean {
  const arrayItem = /^\s+-\s+(.*)$/.exec(line);
  if (!arrayItem || !ctx.pendingKey) return false;
  if (ctx.pendingKind === "unknown") ctx.pendingKind = "array";
  if (ctx.pendingKind !== "array") return false;
  ctx.pendingArray.push(unquote(arrayItem[1] as string));
  return true;
}

function tryConsumeMetaObjectLine(line: string, ctx: MetaParseCtx): boolean {
  const indented = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
  if (!indented || !ctx.pendingKey) return false;
  if (ctx.pendingKind === "unknown") ctx.pendingKind = "object";
  if (ctx.pendingKind !== "object") return false;
  const k = indented[1] as string;
  ctx.pendingObject[k] = unquote(indented[2] ?? "");
  return true;
}

function tryConsumeMetaContinuation(line: string, ctx: MetaParseCtx): boolean {
  if (tryConsumeMetaArrayLine(line, ctx)) return true;
  return tryConsumeMetaObjectLine(line, ctx);
}

function parseMetaTopScalar(line: string, ctx: MetaParseCtx): void {
  const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
  if (!top) return;
  const key = top[1] as string;
  const val = (top[2] ?? "").trim();
  if (val === "") {
    ctx.pendingKey = key;
    ctx.pendingKind = "unknown";
    return;
  }
  if (val === "[]") {
    ctx.out[key] = [];
    return;
  }
  if (val === "{}") {
    ctx.out[key] = {};
    return;
  }
  ctx.out[key] = unquote(val);
}

/**
 * Minimal YAML parser scoped to vault `_meta.md` shape:
 *   - Top-level scalars (`stack: java-spring`)
 *   - Top-level arrays of scalars (`restricted_paths:` + `  - "x"` lines)
 *   - One-deep nested object scalars (`contract:` + `  format: openapi-3`)
 *
 * Anything richer (`!!tag`, anchors, multi-line scalars) is intentionally
 * unsupported — `_meta.md` schema is fixed (vault canon). Promote to a
 * full YAML parser w/ ADR if richer YAML lands.
 *
 * Empty-value keys lazily resolve type on first sub-line:
 *   `key:`           ⇒ pending = unknown
 *   followed by `- ` ⇒ array
 *   followed by `  k:` ⇒ object
 *   followed by next top-level key ⇒ empty array (most permissive default)
 */
export function parseMetaYaml(yaml: string): Record<string, unknown> {
  const ctx: MetaParseCtx = {
    out: {},
    pendingKey: null,
    pendingKind: "unknown",
    pendingArray: [],
    pendingObject: {},
  };
  for (const line of yaml.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (tryConsumeMetaContinuation(line, ctx)) continue;
    flushMetaPending(ctx);
    parseMetaTopScalar(line, ctx);
  }
  flushMetaPending(ctx);
  return ctx.out;
}

export function parseRepoMeta(raw: string): RepoMetaT {
  const { yaml } = splitFrontMatter(raw);
  if (!yaml.trim()) {
    throw new Error("_meta.md has no frontmatter — vault RepoKit example required");
  }
  const obj = parseMetaYaml(yaml);
  const result = RepoMetaSchema.safeParse(obj);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

// ---------- Env mapping ----------

const KNOWN_REPOS: readonly RepoId[] = [
  "spring-api",
  "react-ui",
  "agent-orchestrator",
];

function isKnownRepo(s: string): s is RepoId {
  return (KNOWN_REPOS as readonly string[]).includes(s);
}

function ingestManagedRepoSegment(
  raw: string,
  seg: string,
  out: Partial<Record<RepoId, string>>,
): void {
  if (!seg) return;
  const idx = seg.indexOf(":");
  if (idx <= 0) {
    throw new ManagedRepoEnvError(raw, `expected 'repo-id:/abs/path', got '${seg}'`);
  }
  const repoId = seg.slice(0, idx).trim();
  const cwd = seg.slice(idx + 1).trim();
  if (!isKnownRepo(repoId)) {
    throw new ManagedRepoEnvError(
      raw,
      `unknown repo id '${repoId}' (allowed: ${KNOWN_REPOS.join(", ")})`,
    );
  }
  if (!path.isAbsolute(cwd)) {
    throw new ManagedRepoEnvError(
      raw,
      `cwd for '${repoId}' must be absolute path, got '${cwd}'`,
    );
  }
  if (out[repoId]) {
    throw new ManagedRepoEnvError(raw, `duplicate repo id '${repoId}'`);
  }
  out[repoId] = cwd;
}

export function parseManagedReposEnv(raw: string): Record<RepoId, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {} as Record<RepoId, string>;
  const out: Partial<Record<RepoId, string>> = {};
  for (const pair of trimmed.split(",")) {
    ingestManagedRepoSegment(raw, pair.trim(), out);
  }
  return out as Record<RepoId, string>;
}

// ---------- Loader ----------

export interface ManagedRepoEntry {
  repoId: RepoId;
  supervisorId: SupervisorId;
  cwd: string;
  meta: RepoMetaT;
  profile: StackProfile;
}

export type ManagedRepoMap = Readonly<Record<SupervisorId, ManagedRepoEntry>>;

export interface LoadManagedReposInput {
  envRaw: string;
  /** Injection seam: file reader (tests). */
  readMeta?: (absPath: string) => Promise<string>;
}

async function defaultReadMeta(absPath: string): Promise<string> {
  return readFile(absPath, "utf8");
}

async function loadManagedRepoEntry(
  repoId: RepoId,
  cwd: string,
  reader: (absPath: string) => Promise<string>,
): Promise<ManagedRepoEntry> {
  const metaPath = path.join(cwd, "docs", "_meta.md");
  let raw: string;
  try {
    raw = await reader(metaPath);
  } catch {
    throw new ManagedRepoMetaMissing(repoId, metaPath);
  }
  let meta: RepoMetaT;
  try {
    meta = parseRepoMeta(raw);
  } catch (e) {
    throw new ManagedRepoMetaInvalid(
      repoId,
      metaPath,
      e instanceof Error ? e.message : e,
    );
  }
  let profile: StackProfile;
  try {
    profile = getStackProfile(meta.stack);
  } catch (e) {
    if (e instanceof UnknownStackError) throw e;
    throw e;
  }
  const supervisorId = supervisorIdForRepo(repoId);
  return {
    repoId,
    supervisorId,
    cwd,
    meta,
    profile,
  };
}

export async function loadManagedRepos(
  input: LoadManagedReposInput,
): Promise<ManagedRepoMap> {
  const reader = input.readMeta ?? defaultReadMeta;
  const mapping = parseManagedReposEnv(input.envRaw);

  const out: Partial<Record<SupervisorId, ManagedRepoEntry>> = {};
  for (const [repoIdRaw, cwd] of Object.entries(mapping)) {
    const repoId = repoIdRaw as RepoId;
    const entry = await loadManagedRepoEntry(repoId, cwd, reader);
    out[entry.supervisorId] = entry;
  }
  return out as ManagedRepoMap;
}

export function cwdsFromManagedRepos(map: ManagedRepoMap): Record<SupervisorId, string> {
  const out: Partial<Record<SupervisorId, string>> = {};
  for (const [supId, entry] of Object.entries(map)) {
    out[supId as SupervisorId] = entry.cwd;
  }
  return out as Record<SupervisorId, string>;
}
