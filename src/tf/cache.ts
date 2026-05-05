// I4 deliverable per [[Inngest Integration Plan]] §I4 + task 40.
//
// Purpose: idempotency cache for TF (LLM) calls keyed (runId, agentName, promptHash).
// Why: Inngest step retries replay the entire step body. Without a cache, each retry
// re-spends TF tokens. With cache, replay returns the prior response — zero second
// network call (asserted by tests/tf/cache.test.ts).
//
// Storage: better-sqlite3 (laptop). Same schema works on Postgres later — swap driver.
// Synchronous API on purpose: keeps Inngest step body deterministic (no extra await
// surface for the scheduler to interleave).

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type CacheKey = {
  runId: string;
  agentName: string;
  promptHash: string;
};

export type CacheEntry = {
  response: unknown;
  createdAt: string; // ISO 8601
};

// Canonical-JSON SHA-256 of the LLM prompt + tool schema. Caller produces this;
// promptHash MUST be stable across retries (no timestamps, no Date.now() in input).
export function hashPrompt(canonicalPromptJson: string): string {
  return createHash("sha256").update(canonicalPromptJson, "utf8").digest("hex");
}

// Idempotency key shape used by RunContext.LlmCall (per task 23 + I4).
// Format: `${runId}:${agentName}:${promptHash}` — opaque to Inngest; readable in audit.
export function idempotencyKey(key: CacheKey): string {
  return `${key.runId}:${key.agentName}:${key.promptHash}`;
}

export class TfCache {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private putStmt: Database.Statement;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL"); // concurrent readers don't block writer
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tf_cache (
        run_id       TEXT NOT NULL,
        agent_name   TEXT NOT NULL,
        prompt_hash  TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (run_id, agent_name, prompt_hash)
      );
    `);
    this.getStmt = this.db.prepare(
      "SELECT response_json AS responseJson, created_at AS createdAt FROM tf_cache WHERE run_id = ? AND agent_name = ? AND prompt_hash = ?",
    );
    this.putStmt = this.db.prepare(
      "INSERT OR IGNORE INTO tf_cache (run_id, agent_name, prompt_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
    );
  }

  get(key: CacheKey): CacheEntry | undefined {
    const row = this.getStmt.get(key.runId, key.agentName, key.promptHash) as
      | { responseJson: string; createdAt: string }
      | undefined;
    if (!row) return undefined;
    return { response: JSON.parse(row.responseJson), createdAt: row.createdAt };
  }

  // INSERT OR IGNORE — second writer for same key is a no-op. Race-safe across
  // concurrent step retries on the same runId (Inngest concurrency.key serializes,
  // but defense-in-depth costs nothing).
  put(key: CacheKey, response: unknown): void {
    this.putStmt.run(
      key.runId,
      key.agentName,
      key.promptHash,
      JSON.stringify(response),
      new Date().toISOString(),
    );
  }

  close(): void {
    this.db.close();
  }
}

// Wrapper pattern (lives here so callers + tests share one impl; mastra agents
// will import this directly when TF wiring lands post-I3-stub).
export async function tfCall<TRes>(
  cache: TfCache,
  ctx: { runId: string },
  agentName: string,
  canonicalPromptJson: string,
  fetchFn: () => Promise<TRes>,
): Promise<TRes> {
  const promptHash = hashPrompt(canonicalPromptJson);
  const hit = cache.get({ runId: ctx.runId, agentName, promptHash });
  if (hit) return hit.response as TRes;
  const res = await fetchFn();
  cache.put({ runId: ctx.runId, agentName, promptHash }, res);
  return res;
}

// Forbidden (per Plan §I4): nested `inngest.send()` from inside a Mastra subgraph.
// Would create a second scheduler under the outer DAG; cache + step retries cover it.
