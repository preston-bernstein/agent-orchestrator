import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PlannerOutputT } from "../agents/planner.schema.js";
import type { ReviewerFindingT, ReviewerOutputT } from "../reviewer/schema.js";
import { diffChurnByFile } from "../reviewer/diffPaths.js";

const ApprovalPayloadSchema = z.object({
  run_id: z.string(),
  supervisor: z.string(),
  diff_hash: z.string(),
  reviewer_status: z.string(),
  findings: z.array(z.unknown()),
  gate_summary: z.record(z.unknown()),
  integration_note: z.string().optional(),
  spec_slugs: z.array(z.string()),
  pending_diff_rel: z.string(),
  written_at: z.string(),
});
type ApprovalPayloadT = z.infer<typeof ApprovalPayloadSchema>;

function findingSeverityRank(s: string): number {
  if (s === "error") return 0;
  if (s === "warning") return 1;
  return 2;
}

function filterFindingsForSupervisor(
  findings: readonly ReviewerFindingT[],
  diffFiles: readonly string[],
): ReviewerFindingT[] {
  const set = new Set(diffFiles);
  const mine = findings.filter((f) => {
    if (!f.file) return true;
    return set.has(f.file);
  });
  return [...mine].sort((a, b) => {
    const sa = findingSeverityRank(a.severity);
    const sb = findingSeverityRank(b.severity);
    if (sa !== sb) return sa - sb;
    const fa = a.file ?? "";
    const fb = b.file ?? "";
    return fa.localeCompare(fb);
  });
}

function topChurnRows(churn: ReturnType<typeof diffChurnByFile>, limit: number) {
  const sorted = [...churn].sort((a, b) => b.plus + b.minus - (a.plus + a.minus));
  return sorted.slice(0, limit);
}

interface FormatApprovalInput {
  runId: string;
  runDir: string;
  supervisorId: string;
  diffText: string;
  reviewer: ReviewerOutputT;
  plan: PlannerOutputT;
  integrationNote?: string;
}

function sumChurnTotals(churn: ReturnType<typeof diffChurnByFile>): {
  plus: number;
  minus: number;
} {
  let plus = 0;
  let minus = 0;
  for (const c of churn) {
    plus += c.plus;
    minus += c.minus;
  }
  return { plus, minus };
}

function findingsMarkdownLines(findings: readonly ReviewerFindingT[]): string[] {
  const md: string[] = ["", "## Reviewer findings (this supervisor's files)", ""];
  if (findings.length === 0) {
    md.push("- _(none)_");
    return md;
  }
  for (const f of findings) {
    const loc = f.file ? `${f.file}:${f.line ?? ""}` : "";
    md.push(`- ${f.severity} · ${f.rule} · ${loc} · ${f.message}`);
  }
  return md;
}

function churnTableMarkdown(
  top: { file: string; plus: number; minus: number }[],
  churnLen: number,
): string[] {
  const md: string[] = ["", "## Diff stat (top 20 files by churn)", "", "| File | + | - |", "| ---- | - | - |"];
  for (const row of top) {
    md.push(`| ${row.file} | ${row.plus} | ${row.minus} |`);
  }
  if (churnLen > top.length) {
    md.push("", `_… +${churnLen - top.length} more files; see pending.diff_`);
  }
  return md;
}

/**
 * Writes `approval-prompt.md` + `approval-payload.json` per vault
 * `Build/Prompts/approval-formatter.md` (deterministic MVP).
 */
export function formatApprovalArtifacts(input: FormatApprovalInput): {
  mdPath: string;
  jsonPath: string;
  payload: ApprovalPayloadT;
} {
  const supDir = path.join(input.runDir, input.supervisorId);
  mkdirSync(supDir, { recursive: true });
  const pendingRel = path.join(input.supervisorId, "pending.diff");
  const diffHash = createHash("sha256").update(input.diffText, "utf8").digest("hex");

  const diffFiles = [...new Set(diffChurnByFile(input.diffText).map((c) => c.file))];
  const findings = filterFindingsForSupervisor(input.reviewer.findings, diffFiles);

  const tasks = input.plan.tasks.filter((t) => t.supervisor === input.supervisorId);
  const specSlugs = [...new Set(tasks.map((t) => t.spec_slug))];

  const churn = diffChurnByFile(input.diffText);
  const top = topChurnRows(churn, 20);
  const { plus, minus } = sumChurnTotals(churn);

  const payload: ApprovalPayloadT = ApprovalPayloadSchema.parse({
    run_id: input.runId,
    supervisor: input.supervisorId,
    diff_hash: diffHash,
    reviewer_status: input.reviewer.status,
    findings,
    gate_summary: input.reviewer.gate_summary,
    ...(input.integrationNote !== undefined
      ? { integration_note: input.integrationNote }
      : {}),
    spec_slugs: specSlugs,
    pending_diff_rel: pendingRel.replace(/\\/g, "/"),
    written_at: new Date().toISOString(),
  });

  const mdLines: string[] = [
    `# Approval — ${input.supervisorId} supervisor`,
    "",
    `Run: \`${input.runId}\`  ·  Spec: \`${specSlugs.join(", ") || "?"}\`  ·  Diff: \`${plus}+/${minus}-\`  ·  Files: \`${churn.length}\``,
    "",
    "## Summary",
    "Deterministic templater (Phase 7 MVP) — inspect tasks, gates, reviewer findings, diff stat below.",
    "",
    "## Tasks (this supervisor)",
  ];
  for (const t of tasks) {
    mdLines.push(`- [ ] ${t.id} ${t.title}`);
  }
  if (tasks.length === 0) mdLines.push("- _(no tasks)_");

  mdLines.push("", "## Gate summary", "");
  mdLines.push(`- Fast: ${input.reviewer.gate_summary.fast}`);
  mdLines.push(`- Heavy: ${input.reviewer.gate_summary.heavy}`);
  mdLines.push(...findingsMarkdownLines(findings));

  mdLines.push("", "## Integration impact (if API supervisor)", "");
  mdLines.push(input.integrationNote ?? "- _(n/a or skipped)_");

  mdLines.push(...churnTableMarkdown(top, churn.length));

  mdLines.push(
    "",
    "## How to respond",
    `- Approve: \`pnpm run approve --run ${input.runId} --supervisor ${input.supervisorId}\` _(stub — wire CLI in Phase 7+)_`,
    `- Reject: \`pnpm run reject --run ${input.runId} --supervisor ${input.supervisorId} --reason "<why>"\` _(stub)_`,
    `- Inspect diff: \`git apply --check ${path.join(input.runDir, input.supervisorId, "pending.diff")}\``,
  );

  const mdPath = path.join(supDir, "approval-prompt.md");
  const jsonPath = path.join(supDir, "approval-payload.json");
  writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  return { mdPath, jsonPath, payload };
}
