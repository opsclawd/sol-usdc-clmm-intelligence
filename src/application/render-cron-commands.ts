import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import { buildCronAddArgs } from './cron-command.js';
import { loadCronConfig } from './load-cron-config.js';

export interface RenderCronCommandsDeps {
  textReader: TextReader;
  env: EnvReader;
  configPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function renderCronCommands(
  deps: RenderCronCommandsDeps
): Promise<string[]> {
  const { defaults, preparedJobs } = await loadCronConfig(deps);

  return preparedJobs.map((prepared) => {
    const { args } = buildCronAddArgs({
      job: prepared.job,
      message: prepared.message,
      timezone: defaults.timezone,
      session: defaults.session,
      exact: defaults.exact,
      ...(defaults.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
      ...(defaults.defaultThinking ? { defaultThinking: defaults.defaultThinking } : {}),
      ...(defaults.agent ? { agent: defaults.agent } : {}),
      ...(defaults.delivery ? { delivery: defaults.delivery } : {})
    });
    const flagArgs = args.slice(2);
    const quoted = flagArgs.map((arg) => (arg.startsWith('--') ? arg : shellQuote(arg)));
    return ['openclaw', 'cron', 'add', ...quoted].join(' ');
  });
}