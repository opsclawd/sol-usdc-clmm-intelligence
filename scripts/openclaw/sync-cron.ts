import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { cronSyncJob } from '../../src/jobs/cron-sync-job.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log(
      'Dry run. Pass --apply to create jobs. This script only adds jobs; it does not diff/delete existing jobs.'
    );
  }

  const runtime = createNodeRuntime();
  const result = await cronSyncJob({
    textReader: runtime.textReader,
    env: runtime.env,
    commandRunner: runtime.commandRunner,
    apply
  })();

  for (let index = 0; index < result.commands.length; index += 1) {
    const cmd = result.commands[index]!;
    const name = cmd.args[cmd.args.indexOf('--name') + 1] ?? '(unknown)';
    console.log(`\n# ${name}`);
    console.log(`${cmd.command} ${cmd.args.map((arg) => JSON.stringify(arg)).join(' ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});