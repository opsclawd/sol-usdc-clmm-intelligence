import type { TextReader } from "../ports/text-reader.js";
import type { EnvReader } from "../ports/env.js";
import { buildCronCreateArgs } from "../domain/cron-command.js";
import { loadCronConfig } from "./load-cron-config.js";

export interface RenderCronCommandsDeps {
  textReader: TextReader;
  env: EnvReader;
  configPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const FLAG_NAMES = new Set(["--name", "--deliver"]);

export async function renderCronCommands(deps: RenderCronCommandsDeps): Promise<string[]> {
  const { defaults, preparedJobs } = await loadCronConfig(deps);

  return preparedJobs.map((prepared) => {
    const { command, args } = buildCronCreateArgs({
      job: prepared.job,
      message: prepared.message,
      timezone: defaults.timezone,
      session: defaults.session,
      workingDirectory: defaults.workingDirectory,
      exact: defaults.exact,
      ...(defaults.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
      ...(defaults.defaultThinking ? { defaultThinking: defaults.defaultThinking } : {}),
      ...(defaults.agent ? { agent: defaults.agent } : {}),
      ...(defaults.delivery ? { delivery: defaults.delivery } : {})
    });
    const flagArgs = args.slice(2);
    const quoted = flagArgs.map((arg) => (FLAG_NAMES.has(arg) ? arg : shellQuote(arg)));
    return [command, "cron", "create", ...quoted].join(" ");
  });
}
