import { setTimeout as delay } from "node:timers/promises";

type FollowState = "queued" | "running" | "completed" | "failed" | "cancelled";

interface FollowResult {
  state: FollowState;
  raw: unknown;
}

function stateFromPayload(raw: unknown): FollowState {
  if (!raw || typeof raw !== "object") return "queued";
  const obj = raw as Record<string, unknown>;
  const status = typeof obj.status === "string" ? obj.status : "";
  const normalized = status.toLowerCase();
  const completed = new Set(["completed", "succeeded"]);
  const cancelled = new Set(["cancelled", "canceled"]);
  const running = new Set(["running", "in_progress"]);
  if (completed.has(normalized)) return "completed";
  if (normalized === "failed") return "failed";
  if (cancelled.has(normalized)) return "cancelled";
  if (running.has(normalized)) return "running";
  return "queued";
}

export async function followInngestRun(input: {
  runId: string;
  baseUrl: string;
}): Promise<number> {
  const pollMs = 1200;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${input.baseUrl}/v1/runs/${input.runId}`);
    } catch {
      await delay(pollMs);
      continue;
    }
    if (!res.ok) {
      await delay(pollMs);
      continue;
    }
    const raw = (await res.json()) as FollowResult["raw"];
    const state = stateFromPayload(raw);
    console.log(JSON.stringify({ run_id: input.runId, state }));
    if (state === "completed") return 0;
    if (state === "failed" || state === "cancelled") return 1;
    await delay(pollMs);
  }
}
