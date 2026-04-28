import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { getOptionalEnv } from '../lib/env.js';

interface CronConfig {
  timezone: string;
  session: string;
  modelEnv?: string;
  thinkingEnv?: string;
  agentEnv?: string;
  exactEnv?: string;
  delivery?: {
    channelEnv?: string;
    toEnv?: string;
  };
  jobs: Array<{
    name: string;
    cron: string;
    messageFile: string;
    description?: string;
    model?: string;
    thinking?: string;
  }>;
}

function sh(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function main(): Promise<void> {
  const config = YAML.parse(await readFile('cron/jobs.yaml', 'utf8')) as CronConfig;
  const defaultModel = config.modelEnv ? getOptionalEnv(config.modelEnv) : undefined;
  const defaultThinking = config.thinkingEnv ? getOptionalEnv(config.thinkingEnv) : undefined;
  const agent = config.agentEnv ? getOptionalEnv(config.agentEnv) : undefined;
  const exact = config.exactEnv ? (getOptionalEnv(config.exactEnv) ?? '').toLowerCase() === 'true' : false;
  const channel = config.delivery?.channelEnv ? getOptionalEnv(config.delivery.channelEnv) : undefined;
  const to = config.delivery?.toEnv ? getOptionalEnv(config.delivery.toEnv) : undefined;

  for (const job of config.jobs) {
    const message = await readFile(job.messageFile, 'utf8');
    const args = [
      'openclaw cron add',
      '--name', sh(job.name),
      '--cron', sh(job.cron),
      '--tz', sh(config.timezone),
      '--session', sh(config.session),
      '--message', sh(message)
    ];

    const model = job.model ?? defaultModel;
    const thinking = job.thinking ?? defaultThinking;

    if (model) args.push('--model', sh(model));
    if (thinking) args.push('--thinking', sh(thinking));
    if (agent) args.push('--agent', sh(agent));
    if (exact) args.push('--exact');
    if (channel && to) args.push('--announce', '--channel', sh(channel), '--to', sh(to));

    console.log(args.join(' '));
    console.log('');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
