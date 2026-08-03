#!/usr/bin/env bash
set -euo pipefail

git pull --ff-only
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm cron:sync -- --apply
