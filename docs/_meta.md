---
created: 2026-05-04
updated: 2026-05-04
tags: [meta, repo-manifest, stack]
stack: ts-node
package_manager: pnpm
language_version: 22
codegen_paths: []
generated_markers:
  - "// @generated"
contract:
  format: none
  spec_path: ""
restricted_paths:
  - "tsconfig.json"
  - "vitest.config.ts"
  - "stryker.conf.json"
  - "eslint.config.js"
  - "prompts/**"
owners:
  - prestonbernstein
---

# Repo manifest — `agent-orchestrator`

Frontmatter only. Body intentionally short.

Primary stack `ts-node`. Orchestrator dispatches own quality gates via `src/stacks/ts-node.ts` (mirrors vault `Build/Prompts/Stacks/ts-node` profile; lands Phase 5+).

`contract.format: none` — orchestrator emits no external API contract. Integration agent skips for self-CI runs.

Restricted paths require ADR (`docs/decisions/<date>-NNNN-...`) before edits land in a PR.
