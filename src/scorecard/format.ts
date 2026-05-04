import type { ScorecardModel } from "./aggregate.js";

export function renderScorecardMarkdown(m: ScorecardModel): string {
  const { totals } = m;
  const lines: string[] = [
    `# Scorecard`,
    ``,
    `Generated: ${m.generated_at}`,
    `Runs dir: \`${m.runs_dir}\``,
    ``,
    `## Totals`,
    ``,
    `- Runs scanned: ${totals.runs_scanned}`,
    `- Audit records: ${totals.record_count}`,
    `- Chain breaks: ${totals.chain_breaks}`,
    `- dry_plan_count: ${totals.dry_plan_count}`,
    `- o5_skip_count: ${totals.o5_skip_count}`,
    `- hitl_count: ${totals.hitl_count}`,
    `- tokens_in (sum): ${totals.tokens_in_total}`,
    `- tokens_out (sum): ${totals.tokens_out_total}`,
    ``,
    `## By step (aggregate)`,
    ``,
  ];

  const steps = Object.keys(totals.counts_by_step).sort();
  for (const s of steps) {
    lines.push(`- \`${s}\`: ${totals.counts_by_step[s]}`);
  }
  lines.push(``, `## Per run`, ``, `| run_id | records | chain | dry_plan | o5_skip | hitl |`, `| --- | ---: | --- | ---: | ---: | ---: |`);

  for (const r of m.runs) {
    const chain = r.chain_valid ? "ok" : "BROKEN";
    lines.push(
      `| ${r.run_id} | ${r.record_count} | ${chain} | ${r.dry_plan_count} | ${r.o5_skip_count} | ${r.hitl_count} |`,
    );
  }

  if (m.runs.some((r) => !r.chain_valid)) {
    lines.push(``, `### Chain errors`);
    for (const r of m.runs) {
      if (!r.chain_valid && r.chain_error) {
        lines.push(`- \`${r.run_id}\`: ${r.chain_error}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

export function renderScorecardJson(m: ScorecardModel): string {
  return JSON.stringify(m, null, 2) + "\n";
}
