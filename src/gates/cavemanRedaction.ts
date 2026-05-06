import {
  RedactionFailure,
  findLeak,
  redactString,
} from "../audit/jsonl.js";

export function redactOrFail(text: string, secrets: readonly string[]): {
  text: string;
  passes: number;
} {
  let passes = 0;
  let cur = text;
  for (let i = 0; i < 2; i++) {
    const next = redactString(cur, secrets);
    if (next !== cur) passes++;
    cur = next;
  }
  const leak = findLeak(cur, secrets);
  if (leak) {
    throw new RedactionFailure(leak, "<caveman-gate>");
  }
  return { text: cur, passes };
}
