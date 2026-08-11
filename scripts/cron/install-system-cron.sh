#!/usr/bin/env bash
# Install the generated crontab block, replacing any previous one.
# Idempotent: the block is delimited by the BEGIN/END markers, so re-running
# swaps it rather than appending duplicates.
set -euo pipefail

BEGIN="# BEGIN SOL-USDC CRON"
END="# END SOL-USDC CRON"

block="$(pnpm -s cron:render)"
mkdir -p cron/output

# Existing crontab minus any previous block (and no error when none exists).
existing="$(crontab -l 2>/dev/null | sed "/^${BEGIN}$/,/^${END}$/d" || true)"

printf '%s\n%s\n' "$existing" "$block" | sed '/^$/N;/^\n$/D' | crontab -
echo "installed:"
crontab -l | sed -n "/^${BEGIN}$/,/^${END}$/p"
