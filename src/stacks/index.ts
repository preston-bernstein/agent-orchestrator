import type { StackProfile } from "./types.js";
import { javaSpringProfile } from "./javaSpring.js";

/**
 * Stack registry. Add a profile here + a vault `Build/Prompts/Stacks/<id>.md`
 * overlay file in lockstep — vault canon is single source of truth (A3).
 *
 * Phase 5 only ships `java-spring`. Phase 6 lands `ts-react-vite`. `ts-node`
 * (this orchestrator's own stack) is intentionally absent — Phase 5 supervisor
 * lane runs against managed repos, not self.
 */
const REGISTRY: Readonly<Record<string, StackProfile>> = Object.freeze({
  "java-spring": javaSpringProfile,
});

export class UnknownStackError extends Error {
  constructor(public readonly stackId: string) {
    super(
      `unknown stack id: '${stackId}' — known: ${Object.keys(REGISTRY).join(", ")}`,
    );
    this.name = "UnknownStackError";
  }
}

export function getStackProfile(stackId: string): StackProfile {
  const p = REGISTRY[stackId];
  if (!p) throw new UnknownStackError(stackId);
  return p;
}

export function listStackIds(): readonly string[] {
  return Object.keys(REGISTRY);
}

export { javaSpringProfile };
export type { StackProfile };
