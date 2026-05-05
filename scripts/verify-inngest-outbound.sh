#!/usr/bin/env bash
# 37a outbound-verification gate per ADR 0002 Appendix A.
# Mirrors vault `Build/RepoKits/agent-orchestrator/verify-inngest-outbound.sh.starter`.
#
# Asymmetric cost: false-pass = rip-out post-Phase 5 (huge);
#                  false-fail = bare-Mastra fallback = original plan (zero new cost).
# PR-blocks I3 merge until DoD met. Bounded by criteria, not clock (2-week escalation).
#
# Runs the AUTOMATABLE half: source grep on inngest/inngest.
# The MANUAL half (tcpdump capture, 3 windows) runs out-of-band — see USAGE below.
# Findings go in docs/decisions/2026-05-04-0002-inngest-outer-durable-shell.md Appendix A.

set -euo pipefail

USAGE='Usage: bash scripts/verify-inngest-outbound.sh [--inngest-clone <path>]

Steps automated here:
  1. Clone or use existing inngest/inngest checkout.
  2. Grep server + CLI dirs (NOT SDK) for telemetry strings.
  3. Print hits + suggested triage table for ADR Appendix A.

Steps you run manually (DoD checklist):
  - tcpdump capture, 3 windows: 5-min boot-idle + 5-min steady-idle + 5-min job-run.
  - Verify outbound restricted to 127.0.0.1 / LAN / Postgres+Redis hosts.
  - Capture server commit sha (git -C <clone> rev-parse HEAD) + timestamps.
  - Fill Appendix A in ADR 0002.

Verdict gate (you set it, not the script):
  - All hits explained as false-positive OR disable-able w/ env var → green; unblock I3.
  - Any non-disable-able phone-home → kill switch ADR 0002; revert any Inngest deps.
'

CLONE_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --inngest-clone) CLONE_DIR="$2"; shift 2 ;;
    -h|--help) echo "$USAGE"; exit 0 ;;
    *) echo "unknown arg: $1"; echo "$USAGE"; exit 2 ;;
  esac
done

if [[ -z "$CLONE_DIR" ]]; then
  CLONE_DIR="${TMPDIR:-/tmp}/inngest-verify-$(date +%Y%m%d-%H%M%S)"
  echo "[verify] cloning inngest/inngest → $CLONE_DIR"
  git clone --depth 1 https://github.com/inngest/inngest.git "$CLONE_DIR" >&2
fi

if [[ ! -d "$CLONE_DIR/.git" ]]; then
  echo "[verify] not a git checkout: $CLONE_DIR" >&2
  exit 2
fi

SHA=$(git -C "$CLONE_DIR" rev-parse HEAD)
echo "[verify] inngest server commit: $SHA"
echo "[verify] timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

PATTERNS='posthog|segment|mixpanel|sentry|amplitude|datadog|api\.inngest\.com|inngest\.cloud|telemetry|analytics|phone.?home|usage.?metric'

ROOTS=()
for d in cmd pkg internal; do
  [[ -d "$CLONE_DIR/$d" ]] && ROOTS+=("$CLONE_DIR/$d")
done

if [[ ${#ROOTS[@]} -eq 0 ]]; then
  echo "[verify] no expected source roots found under $CLONE_DIR — repo layout may have changed" >&2
  exit 3
fi

echo "[verify] grep roots: ${ROOTS[*]}"
echo "[verify] patterns: $PATTERNS"
echo

HITS_FILE=$(mktemp)
grep -EnIir "$PATTERNS" "${ROOTS[@]}" 2>/dev/null > "$HITS_FILE" || true

HIT_COUNT=$(wc -l < "$HITS_FILE" | tr -d ' ')
echo "[verify] raw hit count: $HIT_COUNT"
echo

if [[ "$HIT_COUNT" -eq 0 ]]; then
  echo "[verify] CLEAN — no telemetry strings found in server + CLI."
  echo "[verify] Still required: manual tcpdump captures (3 windows) + ADR Appendix A fill."
  echo
  echo "## Appendix A row template (fill in ADR 0002):"
  echo "- Server commit sha: $SHA"
  echo "- Source grep: clean (0 hits across patterns: $PATTERNS)"
  rm -f "$HITS_FILE"
  exit 0
fi

echo "[verify] hits — triage each in ADR 0002 Appendix A:"
echo
printf '| File:Line | Snippet | Verdict (FP / disable-able / blocker) |\n'
printf '| --------- | ------- | -------------------------------------- |\n'
while IFS= read -r line; do
  loc="${line%%:*}"
  rest="${line#*:}"
  ln="${rest%%:*}"
  snip="${rest#*:}"
  snip="${snip//|/\\|}"
  snip=$(echo "$snip" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | cut -c1-120)
  printf '| `%s:%s` | `%s` | _fill_ |\n' "${loc#$CLONE_DIR/}" "$ln" "$snip"
done < "$HITS_FILE"

rm -f "$HITS_FILE"

echo
echo "[verify] NEXT: triage each row above; record verdicts in ADR 0002 Appendix A."
echo "[verify] Run manual tcpdump captures (3 windows) before declaring 37a green."
echo "[verify] If any row is blocker w/ no disable env var → kill switch ADR 0002."
exit 1
