# Runtime Flow

Full orchestrator runtime flow from CLI entry to final summary/exit code.

```mermaid
flowchart TD
  A[CLI: pnpm run orchestrate] --> B[Parse args + load env/expectations]
  B --> C{Spec provided?}
  C -- No --> Z[Print boot summary only]
  C -- Yes --> D[Load spec + init run context<br/>state.json + audit.jsonl]

  D --> E[Run planner branch]
  E --> F{Planner outcome}
  F -- skipped --> Z1[Summary: skipped/dry-plan]
  F -- execution_started --> G{--execute true?}

  G -- No --> Z2[Summary: plan only]
  G -- Yes --> H[runExecuteLane]

  H --> I[Validate managed repos + cwds]
  I --> J[Create shared AuditWriter]
  J --> K{danger_apply?}
  K -- Yes --> K1[Audit HITL escalation]
  K -- No --> L[Run supervisor branch]
  K1 --> L

  L --> M[Group tasks by supervisor<br/>order: spring -> react -> orch -> alpha]
  M --> N[Run supervisor tasks + gates]
  N --> O{Gate failed?}
  O -- No --> P[Task green / emit pending.diff]
  O -- Yes --> Q[Fix-subagent loop]
  Q --> R{Recovered?}
  R -- Yes --> P
  R -- No --> S[budget_exhausted or needs_human_clarify]

  P --> T[Aggregate supervisor status]
  S --> T

  T --> U[Run integration step<br/>contract hash + compatibility verdict]
  U --> V{Aggregate green?}
  V -- No --> W[approval.kind = skipped]
  V -- Yes --> X[Run deterministic reviewer]
  X --> Y{Reviewer fail?}
  Y -- Yes --> Y1[approval.kind = reviewer_fail]
  Y -- No --> Y2{danger_apply?}
  Y2 -- Yes --> Y3[approval.kind = cleared]
  Y2 -- No --> Y4[Write approval artifacts<br/>approval.kind = paused_for_approval]

  W --> AA[Build execute summary]
  Y1 --> AA
  Y3 --> AA
  Y4 --> AB{--wait-approval?}
  AB -- No --> AA
  AB -- Yes --> AC[Poll approvals + update outcome]
  AC --> AA

  AA --> AD[Print final JSON summary]
  AD --> AE[Exit code from reviewer/approval state]
```

Viewer endpoints (served by Hono alongside `/api/inngest`):

- `/runs/<runId>/audit`
- `/runs/<runId>/<supervisor>/pending.diff`
- `/runs/<runId>/<supervisor>/approval.md`
