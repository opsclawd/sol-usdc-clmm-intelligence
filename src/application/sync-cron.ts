import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import type { CommandRunner } from '../ports/command-runner.js';
import {
  buildCronAddArgs,
  type CronCommand
} from '../domain/cron-command.js';
import { loadCronConfig } from './load-cron-config.js';

export interface SyncCronDeps {
  textReader: TextReader;
  env: EnvReader;
  commandRunner: CommandRunner;
  apply: boolean;
  configPath?: string;
}

export interface SyncCronResult {
  commands: CronCommand[];
  apply: boolean;
}

export async function syncCron(deps: SyncCronDeps): Promise<SyncCronResult> {
  const { textReader, env, commandRunner, apply } = deps;
  const { defaults, preparedJobs } = await loadCronConfig({
    textReader,
    env,
    ...(deps.configPath ? { configPath: deps.configPath } : {})
  });

  const commands = preparedJobs.map((prepared) =>
    buildCronAddArgs({
      job: prepared.job,
      message: prepared.message,
      timezone: defaults.timezone,
      session: defaults.session,
      exact: defaults.exact,
      ...(defaults.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
      ...(defaults.defaultThinking ? { defaultThinking: defaults.defaultThinking } : {}),
      ...(defaults.agent ? { agent: defaults.agent } : {}),
      ...(defaults.delivery ? { delivery: defaults.delivery } : {})
    })
  );

  if (apply) {
    for (const cmd of commands) {
      await commandRunner.run(cmd.command, cmd.args);
    }
  }

  return { commands, apply };
}