import type { LoadedCronConfig } from "./load-cron-config.js";

export const CRON_BLOCK_BEGIN = "# BEGIN SOL-USDC CRON";
export const CRON_BLOCK_END = "# END SOL-USDC CRON";

/**
 * Render crontab lines for the scheduled collectors.
 *
 * Three details are load-bearing and were each verified against the target host:
 *
 * - cron runs `SHELL=/bin/sh`, which is dash on Ubuntu. `source` does not exist
 *   there (`/bin/sh: 1: source: not found`), so `.` is used.
 * - `.` alone sets shell variables without exporting them, so a child `node`
 *   process sees none of them. `set -a` around the sourcing is what actually
 *   puts DATABASE_URL and the API keys into the collector's environment.
 * - `flock -n` prevents overlap. `clmm-bundle` runs every 60s; without this a
 *   run lasting longer than its interval would stack copies indefinitely.
 *   `-n` skips the tick rather than queueing it, which matches the freshness
 *   model — a missed sample is better than a backlog of stale ones.
 */
export function renderSystemCron(config: LoadedCronConfig): string[] {
  const wd = config.defaults.workingDirectory;
  const lines: string[] = [CRON_BLOCK_BEGIN];
  for (const { job } of config.preparedJobs) {
    lines.push(
      `${job.cron} cd ${wd} && flock -n cron/output/${job.name}.lock ` +
        `/bin/sh -c 'set -a; . ./.env; set +a; ${job.command}' ` +
        `>> cron/output/${job.name}.log 2>&1`
    );
  }
  lines.push(CRON_BLOCK_END);
  return lines;
}
