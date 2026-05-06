# orch-run — canonical Inngest `step.run` ids

Source of truth for operator docs; keep in sync with `src/inngest/orchestratorRun/*`.

| Step id | When |
| -------- | ---- |
| `expectations-boot` | Every orch handler path — init `runs/<runId>/`, expectations snapshot, first audit line. |
| `tf-probe` | After boot — TF capability probe (skipped when `MOCK_TF` / `TF_SKIP_PROBE`). |
| `planner-branch` | Dry-plan + run paths — O5 + planner + `plan.json` (not gates-only). |
| `load-managed-repos` | Run + gates-verify — parse `ORCH_MANAGED_REPOS`, load `docs/_meta.md` per repo. |
| `sup-task:<taskId>` | Execute lane — one supervisor task body (subagent + gate/fix loop). |
| `gate:<taskId>:<kind>:a<n>` | Execute lane when `wrapGateRun` wired — each `runQuality` / fix-loop attempt (`n` = attempt index). |
| `gate-verify:<supervisor>:<kind>` | **gates-verify only** — managed-repo stack gate w/o planner/subagent. |
| `approve-spring` / `approve-react` | Dynamic `waitForEvent` step ids (`step.waitForEvent`). |
| `audit-finalize` | Run lane terminal audit line (`execution_done`). |
| `audit-gates-verify-finalize` | Gates-verify terminal audit marker. |
