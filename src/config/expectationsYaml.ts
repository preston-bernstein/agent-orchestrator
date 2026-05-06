interface SimpleYamlCtx {
  out: Record<string, unknown>;
  playbook: Record<string, string>;
  inPlaybook: boolean;
}

function stripYamlQuotes(val: string): string {
  return val.replace(/^["']|["']$/g, "");
}

function applySimpleYamlTopKey(top: RegExpExecArray, ctx: SimpleYamlCtx): void {
  ctx.inPlaybook = false;
  const k = top[1] as string;
  const val = top[2] ?? "";
  ctx.out[k] = stripYamlQuotes(val);
}

function tryParseSimpleYamlTopLine(line: string, ctx: SimpleYamlCtx): boolean {
  const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
  if (!top || top[1] === "PLAYBOOK_EXPECTS") return false;
  applySimpleYamlTopKey(top, ctx);
  return true;
}

function tryEnterPlaybookBlock(line: string, ctx: SimpleYamlCtx): boolean {
  if (line.trim() !== "PLAYBOOK_EXPECTS:") return false;
  ctx.inPlaybook = true;
  return true;
}

function tryAppendPlaybookIndented(line: string, ctx: SimpleYamlCtx): void {
  const ind = /^ {2}([a-z0-9_]+):\s*(.*)$/i.exec(line);
  if (!ind?.[1]) return;
  ctx.playbook[ind[1]] = stripYamlQuotes(ind[2] ?? "");
}

function parseSimpleYamlLine(line: string, ctx: SimpleYamlCtx): void {
  if (tryParseSimpleYamlTopLine(line, ctx)) return;
  if (tryEnterPlaybookBlock(line, ctx)) return;
  if (!ctx.inPlaybook) return;
  tryAppendPlaybookIndented(line, ctx);
}

export function splitFrontMatter(raw: string): { yaml: string; body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { yaml: "", body: raw };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) {
    return { yaml: "", body: raw };
  }
  return {
    yaml: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
  };
}

/** Minimal YAML: top-level `key: value` + `PLAYBOOK_EXPECTS` indented block. */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const ctx: SimpleYamlCtx = {
    out: {},
    playbook: {},
    inPlaybook: false,
  };
  for (const line of yaml.split(/\r?\n/)) {
    parseSimpleYamlLine(line, ctx);
  }
  if (Object.keys(ctx.playbook).length > 0) {
    ctx.out.PLAYBOOK_EXPECTS = ctx.playbook;
  }
  return ctx.out;
}
