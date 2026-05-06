import type { DecisionInput } from "./types.js";

function validateCliDecision(out: DecisionInput): DecisionInput {
  if (!out.runId || !out.supervisor) {
    throw new Error("usage: --approve|--reject --run <id> --supervisor <id> [--reason <text>] [--note <text>]");
  }
  if (!out.approved && !(out.reason?.trim())) throw new Error("--reject requires --reason");
  return out;
}

export function parseCli(argv: readonly string[]): DecisionInput {
  const out: DecisionInput = { runId: "", supervisor: "", approved: false };
  const readNext = (i: number): string => argv[i + 1] ?? "";
  const setByFlag: Record<string, (i: number) => void> = {
    "--approve": () => {
      out.approved = true;
    },
    "--reject": () => {
      out.approved = false;
    },
    "--run": (i) => {
      out.runId = readNext(i);
    },
    "--supervisor": (i) => {
      out.supervisor = readNext(i);
    },
    "--reason": (i) => {
      out.reason = readNext(i);
    },
    "--note": (i) => {
      out.note = readNext(i);
    },
    "--runs-dir": (i) => {
      out.runsDir = readNext(i);
    },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    const setter = setByFlag[a];
    if (!setter) continue;
    setter(i);
    if (a !== "--approve" && a !== "--reject") i += 1;
  }
  return validateCliDecision(out);
}
