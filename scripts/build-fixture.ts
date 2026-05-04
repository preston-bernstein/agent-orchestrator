import { rmSync } from "node:fs";
import path from "node:path";
import { AuditWriter } from "../src/audit/jsonl.js";

const out = path.resolve("runs", "_fixture_phase2");
rmSync(out, { recursive: true, force: true });
const w = new AuditWriter({ path: path.join(out, "audit.jsonl") });
w.write({ run_id: "fixture", step: "boot", agent: "system", timestamp: "2026-05-04T08:00:00Z" });
w.write({
  run_id: "fixture",
  step: "planner",
  agent: "planner",
  tokens_in: 120,
  tokens_out: 240,
  model: "mock",
  timestamp: "2026-05-04T08:00:01Z",
});
w.write({
  run_id: "fixture",
  step: "gate-quality-fast",
  agent: "gate",
  cmd: ["pnpm", "test:run"],
  cwd: ".",
  exit: 0,
  timestamp: "2026-05-04T08:00:02Z",
});
console.log(path.join(out, "audit.jsonl"));
