import { createNodeRuntime } from "../../src/adapters/node/composition-root.js";
import { cronSyncJob } from "../../src/jobs/cron-sync-job.js";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(
      "Dry run. Pass --apply to create missing jobs and edit existing jobs. Jobs absent from cron/jobs.yaml are not deleted."
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
    const action = cmd.args[1];
    const label =
      action === "create"
        ? (cmd.args[cmd.args.indexOf("--name") + 1] ?? "(unknown)")
        : `job ${cmd.args[2] ?? "(unknown id)"}`;
    console.log(`\n# ${action} ${label}`);
    console.log(`${cmd.command} ${cmd.args.map((arg) => JSON.stringify(arg)).join(" ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
