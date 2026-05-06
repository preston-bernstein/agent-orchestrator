import { readFileSync } from "node:fs";

export function auditTailPrevHash(auditPath: string, fallback: string): string {
  try {
    const lines = readFileSync(auditPath, "utf8").trim().split("\n").filter(Boolean);
    const tail = lines[lines.length - 1];
    if (!tail) return fallback;
    return (JSON.parse(tail) as { hash: string }).hash;
  } catch {
    return fallback;
  }
}
