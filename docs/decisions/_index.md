---
created: 2026-05-04
updated: 2026-05-05
tags: [decision, adr, index]
---

# Decisions index — `agent-orchestrator`

| ADR  | Title | Status   | Date       | Supersedes | Superseded by | Notes |
| ---- | ----- | -------- | ---------- | ---------- | ------------- | ----- |
| 0001 | Phase 2 trigger evaluation — PoC mock pass + real-TF graduation gate | accepted | 2026-05-04 | — | — | Phase 9 closeout; O7 bars met on mock surface, real-TF graduation pending |
| 0002 | Inngest = outer durable shell, Mastra = inner pure-fn | accepted | 2026-05-04 (37a manual half ran 2026-05-05) | — | — | Mirrors vault Examples ADR 0003; 37a Appendix A both halves GREEN on laptop PoC; sha-alignment + execution-path re-runs owed pre-prod |
| 0003 | Observability split — Inngest UI + `audit.jsonl` hash chain (both sinks kept) | accepted | 2026-05-05 | — | — | Mirrors vault Examples ADR 0004; locks single-writer invariant + verifier CLI Inngest-independence ahead of I3 |
| 0004 | Inngest self-host prod target — own Postgres + Redis on internal LAN (deferred) | proposed | 2026-05-05 | — | — | Mirrors vault Examples ADR 0005; status `proposed` until laptop I3 + I5 + sha-aligned 37a re-run on prod binary |

## Conventions

- ADR id = 4-digit zero-padded, sequential per repo.
- File: `YYYY-MM-DD-NNNN-<slug>.md`.
- Status: `proposed | accepted | superseded | deprecated`.
- Use vault `Templates/decision.md.template` for new entries.
- Vault Examples ADRs (0001 Mastra default, 0002 Stack profile, 0003 Inngest outer durable shell, 0004 Observability split, 0005 Inngest self-host prod target) mirror **at scaffold-time per phase** — not preloaded. Track in vault `Build/Playbook` + `docs/playbook-expectations.md`.
