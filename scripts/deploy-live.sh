#!/usr/bin/env bash
set -euo pipefail

git pull --ff-only
pnpm install --frozen-lockfile
pnpm db:migrate
# Collectors run on system cron, not the Hermes agent. This re-installs the
# crontab block from cron/jobs.yaml on every deploy so schedule changes ship
# with the code. It replaces the previous block rather than appending.
pnpm cron:install
