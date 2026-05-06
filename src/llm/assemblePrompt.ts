import type { ToonSection } from "./toonContext.js";
import type { PathOwnership } from "./types.js";
import {
  checkPathOwnership,
  PathOwnershipViolation as PathOwnershipViolationError,
  globMatch,
} from "./assemblePromptOwnership.js";
import { collectPromptSections } from "./assemblePromptSections.js";

/**
 * O8 + SF4 — assemble the model-input string in the order canonized by
 * `Build/Prompts/Index.md` §"Prompt assembly order"; refuse on:
 *   1. **assembled est tokens > `ORCH_MAX_PROMPT_TOKENS`** (default 100k)
 *   2. **declared paths outside owner's `path_ownership_map[ownerKey]`**
 *      (edge 7 — supervisor narrows further; assembler is first defense).
 *
 * Estimator: `Math.ceil(chars / 4)` MVP. Tokenizer-for-target-model swap
 * deferred until TF model wiring lands per O8.
 */

interface AssemblePromptInput {
  /** Caveman-gate output (compressed user-facing text). */
  caveman: string;
  /** Optional TOON-encoded slices (allowlist per O6). */
  toonSections?: readonly ToonSection[];
  /** Role base prompt (`Build/Prompts/<role>.md`). */
  basePrompt: string;
  /** Stack overlay appended for stack-bound roles. */
  stackOverlay?: string;
  /** RunContext slice — JSON prose or already-formatted text. */
  taskContext?: string;
  /** XML-wrapped blobs (`spec_excerpt`, `gate_log`, …) per O8 #3. */
  xmlBlobs?: readonly { tag: string; body: string }[];
  /** Structured-output schema description (O1). */
  outputSchema?: string;
  /** Agent role id for audit trail (`planner`, `spring-supervisor`, …). */
  agentRole: string;
  /** File-path globs this hop asserts authority over (path_ownership_map[ownerKey]). */
  declaredPaths?: readonly string[];
  /** Full path_ownership_map snapshot (RunContext). */
  pathOwnership?: PathOwnership;
  /** Key into `pathOwnership` for this agent (e.g. `'planner'`, `'spring-T1'`). */
  ownerKey?: string;
  /** Override default 100k cap (env `ORCH_MAX_PROMPT_TOKENS`). */
  maxPromptTokens?: number;
}

export interface AssembledPrompt {
  text: string;
  estTokens: number;
  agentRole: string;
  sections: readonly string[];
}

export class PromptBudgetError extends Error {
  constructor(
    public readonly estTokens: number,
    public readonly cap: number,
    public readonly agentRole: string,
  ) {
    super(
      `prompt budget exceeded: agent=${agentRole} est=${estTokens} cap=${cap} ` +
        `(set ORCH_MAX_PROMPT_TOKENS or shrink caveman/TOON input — never silent truncation)`,
    );
    this.name = "PromptBudgetError";
  }
}

const DEFAULT_CAP = 100_000;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function readEnvCap(): number {
  const n = Number(process.env.ORCH_MAX_PROMPT_TOKENS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CAP;
  return Math.floor(n);
}

export { globMatch };
export { PathOwnershipViolationError as PathOwnershipViolation };

export function assemblePrompt(input: AssemblePromptInput): AssembledPrompt {
  if (input.declaredPaths && input.pathOwnership && input.ownerKey) {
    checkPathOwnership(input.declaredPaths, input.pathOwnership, input.ownerKey);
  }

  const sections = collectPromptSections(input);
  const text = sections.join("\n\n");
  const estTokens = estimateTokens(text);
  const cap = input.maxPromptTokens ?? readEnvCap();
  if (estTokens > cap) {
    throw new PromptBudgetError(estTokens, cap, input.agentRole);
  }
  return { text, estTokens, agentRole: input.agentRole, sections };
}
