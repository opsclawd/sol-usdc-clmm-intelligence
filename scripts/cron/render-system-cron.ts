import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { loadCronConfig } from "../../src/application/load-cron-config.js";
import { renderSystemCron } from "../../src/application/render-system-cron.js";

/**
 * Print the crontab block for the scheduled collectors.
 *
 * `cron:render` prints it for inspection; `cron:install` pipes it into the
 * user crontab, replacing any previous block bounded by the BEGIN/END markers
 * so repeated installs are idempotent.
 */
async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const config = await loadCronConfig({ textReader: runtime.textReader, env: runtime.env });
  process.stdout.write(renderSystemCron(config).join("\n") + "\n");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
