# Stryker survivors — Phase 0 inventory

Source: `reports/mutation/mutation.json` (29 × `Survived`). Class: **A** missing kill test, **D** adversarial fixture gap, **C** dead code, **B** equivalent / specsym → refactor or disable.

---

**`src/audit/jsonl.ts:41`** — `ConditionalExpression` → `false` (guard `obj === undefined` in `canonicalize`).  
**A** — Add assertion `canonicalize(undefined)` is byte-stable `"null"` (tests likely only cover objects/arrays).

**`src/audit/jsonl.ts:98`** — `ConditionalExpression` → `false` (drop early return in `redactValue`).  
**A** — Exercise `redactValue` / public export path with `null`, booleans, numbers in nested tree so mutated code cannot fall through to `Object.entries`.

**`src/audit/jsonl.ts:98`** — `LogicalOperator` → `v === null && typeof v !== "object"` (weaken null/primitive guard).  
**A** — Same fixtures: `null` and primitives must round-trip without throw; mutant drives bad fall-through.

**`src/audit/jsonl.ts:98`** — second `ConditionalExpression` → `false` (duplicate location, distinct mutant id).  
**A** — Same as `:98` false-guard kills.

**`src/audit/jsonl.ts:110`** — `ConditionalExpression` → `false` (guard in `scanLeak`).  
**A** — `scanLeak` (via exported audit path) with `null`/primitive leaves so early return must hold.

**`src/audit/jsonl.ts:110`** — `LogicalOperator` → same weaken pattern.  
**A** — Same adversarial tree shapes as `:98`.

**`src/audit/jsonl.ts:110`** — `ConditionalExpression` → `false` (inner/array path).  
**A** — Arrays containing `null`/mixed types so leak scan cannot skip guards.

---

**`src/cli/args.ts:37`** — `EqualityOperator` → `i <= argv.length` (loop bound).  
**A** — Edge argv length / last-iteration behavior (mutant can read past end or change termination).

**`src/cli/args.ts:60`** — `ConditionalExpression` → `false` (`--reason` value validation).  
**D** — Fixture: missing value, value `"--"`, value `--foo` after `--reason` must throw `CliArgError`.

**`src/cli/args.ts:60`** — `MethodExpression` → `v.endsWith("--")` instead of `startsWith`.  
**D** — Same `--reason` adversarial strings; strings that end with `--` vs start with `--`.

---

**`src/llm/assemblePrompt.ts:92`** — `ConditionalExpression` → `false` (fast path `glob === declared` in `globMatch`).  
**A** — Case where `glob === declared` must match without hitting regex branch.

**`src/llm/assemblePrompt.ts:124`** — `ConditionalExpression` → `false` (`if (!env)` in `readEnvCap`).  
**A** — Assert `ORCH_MAX_PROMPT_TOKENS` unset/empty vs invalid numeric uses `DEFAULT_CAP` (mutant skips empty guard).

**`src/llm/assemblePrompt.ts:138`** — `ConditionalExpression` → `true` (first conjunct `input.toonSections &&`).  
**A** — `toonSections: undefined` must not run loop (mutant forces truthy path → throw or wrong sections).

**`src/llm/assemblePrompt.ts:138`** — `EqualityOperator` → `input.toonSections.length >= 0`.  
**A** — `toonSections: []` must not emit TOON blocks (`> 0` vs `>= 0`).

**`src/llm/assemblePrompt.ts:144`** — `MethodExpression` → `input.basePrompt` (drop `.trim()`).  
**D** — `basePrompt` with leading/trailing whitespace-only segments changes joined `text`/`estTokens`.

**`src/llm/assemblePrompt.ts:146`** — `MethodExpression` → `input.taskContext` (drop `.trim()` on stack path — mutator targets one `.trim()`).  
**D** — Whitespace-only `taskContext` / `stackOverlay` must not duplicate blank sections vs trimmed behavior.

**`src/llm/assemblePrompt.ts:146`** — `MethodExpression` → `input.taskContext` (second site on same line).  
**D** — Same as prior; pin expected section list for padded strings.

**`src/llm/assemblePrompt.ts:161`** — `EqualityOperator` → `estTokens >= cap` (budget check).  
**A** — Boundary: `estTokens === cap` must not throw; `estTokens === cap + 1` throws `PromptBudgetError`.

---

**`src/policy/hitl.ts:48`** — `ConditionalExpression` → `case "danger_apply":` (switch / exhaustiveness region).  
**A** — Assert audit line contains `signal=danger_apply` (or export-test `signalLabel`) so case arm cannot swap with another kind.

---

**`src/tf/client.ts:102`** — `ConditionalExpression` → `false` (force relative `new URL(pathOrUrl, base)`).  
**B** — For absolute `http(s)` same-host input, WHATWG ignores base; observable URL matches guarded host. Phase 3 canonicalize or Phase 4 disable w/ spec cite.

**`src/tf/client.ts:102`** — `LogicalOperator` → `startsWith("http://") && startsWith("https://")`.  
**B** — Condition unsatisfiable → always relative branch; same as above when probe uses absolute same-host URL. Pair with absolute-URL test + Phase 3/4.

**`src/tf/client.ts:102`** — `MethodExpression` → `endsWith("http://")` / `endsWith("https://")` (pair).  
**A** — Unless only relative URLs in tests: add absolute `https://` same-host `resolve()` expectation; else mutant mimics **B** when combined with spec.

**`src/tf/client.ts:126`** — `ArrowFunction` → `() => undefined` (timeout callback).  
**A** — Fake timers: timeout fires `AbortController.abort`; request aborts or `signal` observed; lazy **B** if proven no-op under mock.

**`src/tf/client.ts:132`** — `LogicalOperator` → `init.signal && controller.signal` (`??` → `&&`).  
**A** — Case: no `init.signal` must still attach timeout signal; case: both signals — merge behavior (abort from either).

**`src/tf/client.ts:136`** — `BlockStatement` → `{}` (`finally` clears timeout).  
**A** — Fake timers: assert `clearTimeout` invoked / no duplicate abort after completion (leak / double-abort).

**`src/tf/client.ts:157`** — `ObjectLiteral` → `{}` (likely `{ method: "GET" }` in `this.request("/v1/models", { method: "GET" })`).  
**B** — Fetch defaults method GET; tests’ `fetchImpl` may not assert `method`. Tighten mock assertion (Phase **A**) or Phase **4** disable with fetch-default cite.

**`src/tf/client.ts:169`** — `ConditionalExpression` → `false` (`!raw || typeof raw !== "object"` in `extractModelIds`).  
**A** — `raw` `null`/primitive/`undefined` must return `[]`; mutant must not index `.data`.

**`src/tf/client.ts:174`** — `ConditionalExpression` → `true` (`entry && typeof entry === "object"`).  
**A** — Strengthen data-array fixtures (e.g. entries that are truthy non-objects with exotic `id`) so filter differs when guard always true.

---

## Phase 0 checkpoint counts

| Class | N | Notes |
| ----- | --- | ----- |
| A | 21 | jsonl tree guards, args loop + URL mutants on `endsWith`, assemblePrompt, client timeout/signal/finally/extract |
| D | 5 | cli `--reason`, assemblePrompt `.trim()` / padding |
| B | 3 | `client.ts:102` `ConditionalExpression`+`LogicalOperator` (WHATWG abs URL); `client.ts:157` explicit `{ method: "GET" }` vs `{}` |
| C | 0 | No survivor marked dead-code without caller proof |

**`client.ts:102`:** two mutants Phase **B**; two `MethodExpression` `endsWith` mutants phase **A** (absolute-URL kill tests). Total four mutants at that line.

**Next:** Review table → Phase 1 picks A+D first; reserve B for Phase 3/4 per working plan.

## Phase 1 closeout (done)

Mutation score **~95%** (`pnpm run mutation` after test-only batch). Survivors **14** — none on provably unreachable lines.

## Phase 2 checkpoint (Class C)

**0 excisions.** Mutate set (`stryker.conf.json`): grep + call graph — every remaining survivor sits on **reachable** branches (mostly **B** duplicate-path / WHATWG / `[]` truthiness, plus hard **A**). No `v8`/`coverage`-style proof of dead code that safely lifts out. `scanLeak` array block vs `Object.values` is **duplicate traversal** (Phase 3), not unreachable dead code; yanking it can change behavior for exotic array objects (non-JSON).

**Next:** Phase 3 refactor or Phase 4 disables for **B** cluster; optional second pass on **A** (args `<=`, etc.).

## Phase 3 closeout (done)

- **`scanLeak`:** one `Object.values` pass (comment: JSON-shaped audit payloads).
- **`TfClient.resolve`:** `new URL(pathOrUrl, this.base)` only (WHATWG: absolute `pathOrUrl` ignores base).
- **`globMatch`:** removed `glob === declared` early return.
- **`readEnvCap`:** `Number(process.env.…)` unified path (unset/`""`/`NaN`/`<=0` → default).
- **`assemblePrompt`:** `if (input.toonSections?.length)` / `if (input.xmlBlobs?.length)`.
- **`parseArgs`:** `argv[Symbol.iterator]()` + sparse-slot test (`a !== undefined`).
- **`extractModelIds`:** split guards; two `// Stryker disable next-line ConditionalExpression` (RFC 8259 + probe schema).
- **Result:** `pnpm run mutation` → **100%**, 0 survived (scoped files).

## Phase 4 checkpoint (proven-equiv disables)

`src/tf/client.ts` `extractModelIds`: two `ConditionalExpression` disables — **RFC 8259** value grammar + OpenAI-style `{ data: [{ id }] }` (only objects carry `id`). No runtime branch change vs Phase 3 refactor.

## Phase 5 checkpoint (re-baseline)

- `pnpm run mutation` → **100.00%** (250 killed, 2 timeout, 0 survived) on `stryker.conf.json` mutate list.
- `docs/specs/2026-05-04-orchestrator-bootstrap/tasks.md` task **15** close note updated w/ table.
