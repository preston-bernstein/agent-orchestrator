import path from "node:path";
import type { PlannerOutputT } from "../agents/planner/schema.js";
import type { ReviewerFindingT, ReviewerOutputT } from "../reviewer/schema.js";
import { diffChurnByFile } from "../reviewer/diffPaths.js";

function topChurnRows(churn: ReturnType<typeof diffChurnByFile>, limit: number) {
  const sorted = [...churn].sort((a, b) => b.plus + b.minus - (a.plus + a.minus));
  return sorted.slice(0, limit);
}

function sumChurnTotals(churn: ReturnType<typeof diffChurnByFile>): { plus: number; minus: number } {
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
  if (findings.length === 0) return [...md, "- _(none)_"];
  for (const f of findings) {
    const loc = f.file ? `${f.file}:${f.line ?? ""}` : "";
    md.push(`- ${f.severity} · ${f.rule} · ${loc} · ${f.message}`);
  }
  return md;
}

function churnTableMarkdown(top: { file: string; plus: number; minus: number }[], churnLen: number): string[] {
  const md: string[] = ["", "## Diff stat (top 20 files by churn)", "", "| File | + | - |", "| ---- | - | - |"];
  for (const row of top) {
    md.push(`| ${row.file} | ${row.plus} | ${row.minus} |`);
  }
  if (churnLen > top.length) md.push("", `_… +${churnLen - top.length} more files; see pending.diff_`);
  return md;
}

export function buildApprovalMarkdown(params: {
  runId: string;
  runDir: string;
  supervisorId: string;
  reviewer: ReviewerOutputT;
  tasks: PlannerOutputT["tasks"];
  specSlugs: string[];
  findings: ReviewerFindingT[];
  churn: ReturnType<typeof diffChurnByFile>;
  integrationNote?: string;
}): string[] {
  const { plus, minus } = sumChurnTotals(params.churn);
  const top = topChurnRows(params.churn, 20);
  const mdLines: string[] = [
    `# Approval — ${params.supervisorId} supervisor`,
    "",
    `Run: \`${params.runId}\`  ·  Spec: \`${params.specSlugs.join(", ") || "?"}\`  ·  Diff: \`${plus}+/${minus}-\`  ·  Files: \`${params.churn.length}\``,
    "",
    "## Summary",
    "Deterministic templater — inspect tasks, gates, reviewer findings, diff stat below.",
    "",
    "## Tasks (this supervisor)",
    ...params.tasks.map((t) => `- [ ] ${t.id} ${t.title}`),
  ];
  if (params.tasks.length === 0) mdLines.push("- _(no tasks)_");
  mdLines.push("", "## Gate summary", "");
  mdLines.push(`- Fast: ${params.reviewer.gate_summary.fast}`);
  mdLines.push(`- Heavy: ${params.reviewer.gate_summary.heavy}`);
  mdLines.push(...findingsMarkdownLines(params.findings));
  mdLines.push("", "## Integration impact (if API supervisor)", "");
  mdLines.push(params.integrationNote ?? "- _(n/a or skipped)_");
  mdLines.push(...churnTableMarkdown(top, params.churn.length));
  mdLines.push(
    "",
    "## How to respond",
    `- Approve: \`pnpm run approve -- --run ${params.runId} --supervisor ${params.supervisorId} [--note "<reason>"]\``,
    `- Reject: \`pnpm run reject -- --run ${params.runId} --supervisor ${params.supervisorId} --reason "<why>"\``,
    `- Inspect diff: \`git apply --check ${path.join(params.runDir, params.supervisorId, "pending.diff")}\``,
  );
  return mdLines;
}
