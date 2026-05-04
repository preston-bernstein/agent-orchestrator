---
created: 2026-05-04
updated: 2026-05-04
repo: agent-orchestrator
vault_repo_label: "Home Network Vault"
vault_git_sha: "15079571ebd9d52fcf77dd84ff06f67d69d3b941"
vault_cut_date: "2026-05-04"
playbook_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook.md"
fidelity_plan_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook Fidelity Plan.md"
tags: [orchestrator, playbook-expectations, a3]
purpose: A3 pin-the-brain — which vault Build snapshot this repo matches. Bump chore commit when RunContext, audit records, assembler, Patterns baseline, or prompt mirrors change.
---

# playbook-expectations (A3)

Orchestrator code is **downstream** of vault canon under `Orchestration PoC/Build/`. README **`PLAYBOOK_EXPECTS`** block duplicates the sha/date for quick glance — **keep both aligned**.

## Pinned snapshot

```yaml
PLAYBOOK_EXPECTS:
  vault_repo_label: "Home Network Vault"
  vault_git_sha: "15079571ebd9d52fcf77dd84ff06f67d69d3b941"
  vault_cut_date: "2026-05-04"
  playbook_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook.md"
  fidelity_plan_path: "Development/Vibe Coding Hardening/Orchestration PoC/Build/Playbook Fidelity Plan.md"
```

Local working copy lives at `./Orchestration PoC/` (gitignored). Canon = vault repo at sha above.

## Canon checklist (explicit bump required if any drift)

- **Dry-plan mutation gate (A4)** ↔ `Build/Playbook.md` Phase 4 + `Build/Patterns/O5-planner-dry-run.md` — O5 deterministic lane before planner TF; **`--dry-plan`** stops before supervisors; **`--execute`** audited.
- **HITL signals (C1–C5)** ↔ `Build/Playbook.md` § **Human in the loop** — mirror `Build/Playbook Fidelity Plan.md` §C when vault updates.
- **RunContext** ↔ `Build/RunContext.md` — schema + fields (Zod single source of truth).
- **Audit JSONL** ↔ `Build/Audit Hash Chain.md` — one JSON object per line, `prev_hash` chain — **never TOON inside the file**.
- **TOON** ↔ `Build/Patterns/O6-toon-llm-boundary.md` — only at **assembled LLM input** boundary; audit + tooling stay JSON.
- **Prompts** ↔ `Build/Prompts/` — in-repo `prompts/**` mirrors must move in lockstep w/ cited vault files (commit body cites path).
- **Patterns O1–O8** ↔ `Build/Patterns/Index.md` — no silent restate; link + implement.
- **Token budgets** ↔ `Build/Patterns/O3-per-agent-token-budgets.md`.
- **Fidelity steps** ↔ `Build/Playbook Fidelity Plan.md` — human tracks Progress there; this file tracks **code↔vault SHA**.

## Bump procedure

1. Re-snapshot vault: `git -C "<vault>" rev-parse HEAD` → update `vault_git_sha` here + README.
2. Run `pnpm run orchestrate` to confirm boot loads new snapshot ok (no warnings).
3. Commit: `chore(a3): bump vault snapshot to <short-sha>`.
4. If schema/audit/prompt semantics changed too → ADR in `docs/decisions/`.

## Optional ADR

Promote a breaking alignment change to `docs/decisions/` using vault `Templates/decision.md.template`; sequence number = repo's next free id.

## Tied to

- Vault `Build/Playbook` Phase 1 (this file + README block).
- Vault `Build/Audit Hash Chain` — hash chain semantics.
- Vault `Build/Playbook Fidelity Plan` — Step 5 (A3).
