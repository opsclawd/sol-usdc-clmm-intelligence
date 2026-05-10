import YAML from 'yaml';
import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import type {
  CronConfig,
  PreparedCronJob,
  ResolvedCronDefaults
} from '../contracts/cron-config.js';

export interface LoadCronConfigDeps {
  textReader: TextReader;
  env: EnvReader;
  configPath?: string;
}

export interface LoadedCronConfig {
  defaults: ResolvedCronDefaults;
  preparedJobs: PreparedCronJob[];
}

export const DEFAULT_CRON_CONFIG_PATH = 'cron/jobs.yaml';

export async function loadCronConfig(
  deps: LoadCronConfigDeps
): Promise<LoadedCronConfig> {
  const { textReader, env, configPath = DEFAULT_CRON_CONFIG_PATH } = deps;
  const config = YAML.parse(await textReader.readText(configPath)) as CronConfig;

  const defaultModel = config.modelEnv ? env.getOptional(config.modelEnv) : undefined;
  const defaultThinking = config.thinkingEnv
    ? env.getOptional(config.thinkingEnv)
    : undefined;
  const agent = config.agentEnv ? env.getOptional(config.agentEnv) : undefined;
  const exact = config.exactEnv
    ? (env.getOptional(config.exactEnv) ?? '').toLowerCase() === 'true'
    : false;
  const channel = config.delivery?.channelEnv
    ? env.getOptional(config.delivery.channelEnv)
    : undefined;
  const to = config.delivery?.toEnv ? env.getOptional(config.delivery.toEnv) : undefined;

  const defaults: ResolvedCronDefaults = {
    timezone: config.timezone,
    session: config.session,
    ...(defaultModel ? { defaultModel } : {}),
    ...(defaultThinking ? { defaultThinking } : {}),
    ...(agent ? { agent } : {}),
    exact,
    ...(channel && to ? { delivery: { channel, to } } : {})
  };

  const preparedJobs: PreparedCronJob[] = await Promise.all(
    config.jobs.map(async (job) => {
      const message = await textReader.readText(job.messageFile);
      const model = job.model ?? defaultModel;
      const thinking = job.thinking ?? defaultThinking;
      return {
        job,
        message,
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {})
      };
    })
  );

  return { defaults, preparedJobs };
}