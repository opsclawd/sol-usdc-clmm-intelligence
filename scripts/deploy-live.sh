#!/usr/bin/env bash
set -euo pipefail

# To prevent bash from executing a mix of old and new content when git pull 
# changes this script mid-execution, we use the re-exec approach.
# We pull, then re-execute the freshly pulled script with --post-pull to
# ensure we run the new deployment steps.
if [ "${1:-}" = "--post-pull" ]; then
  shift
else
  git pull --ff-only
  exec "$0" --post-pull "$@"
fi

pnpm install --frozen-lockfile
pnpm db:migrate
# Collectors run on system cron, not the Hermes agent. This re-installs the
# crontab block from cron/jobs.yaml on every deploy so schedule changes ship
# with the code. It replaces the previous block rather than appending.
pnpm cron:install

