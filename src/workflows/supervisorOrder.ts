/** API-first: spring → react → orch. Unknown ids defer to localeCompare. */
const SUPERVISOR_ORDER: readonly string[] = ["spring", "react", "orch"];

export function compareSupervisorIds(a: string, b: string): number {
  const ai = SUPERVISOR_ORDER.indexOf(a);
  const bi = SUPERVISOR_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
