import type { LoadedCronConfig } from "./load-cron-config.js";

export function renderSystemCron(config: LoadedCronConfig): string[] {
  const lines: string[] = ["# BEGIN SOL-USDC CRON"];
  for (const { job } of config.preparedJobs) {
    lines.push(
      `${job.cron} cd ${config.defaults.workingDirectory} && source .env && ${job.command} >> cron/output/${job.name}.log 2>&1`
    );
  }
  lines.push("# END SOL-USDC CRON");
  return lines;
}
