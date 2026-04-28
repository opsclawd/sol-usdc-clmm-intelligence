import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
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

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const config = YAML.parse(await readFile('cron/jobs.yaml', 'utf8')) as CronConfig;
  const defaultModel = config.modelEnv ? getOptionalEnv(config.modelEnv) : undefined;
  const defaultThinking = config.thinkingEnv ? getOptionalEnv(config.thinkingEnv) : undefined;
  const agent = config.agentEnv ? getOptionalEnv(config.agentEnv) : undefined;
  const exact = config.exactEnv ? (getOptionalEnv(config.exactEnv) ?? '').toLowerCase() === 'true' : false;
  const channel = config.delivery?.channelEnv ? getOptionalEnv(config.delivery.channelEnv) : undefined;
  const to = config.delivery?.toEnv ? getOptionalEnv(config.delivery.toEnv) : undefined;

  if (!apply) {
    console.log('Dry run. Pass --apply to create jobs. This script only adds jobs; it does not diff/delete existing jobs.');
  }

  for (const job of config.jobs) {
    const message = await readFile(job.messageFile, 'utf8');
    const args = [
      'cron', 'add',
      '--name', job.name,
      '--cron', job.cron,
      '--tz', config.timezone,
      '--session', config.session,
      '--message', message
    ];

    const model = job.model ?? defaultModel;
    const thinking = job.thinking ?? defaultThinking;

    if (model) args.push('--model', model);
    if (thinking) args.push('--thinking', thinking);
    if (agent) args.push('--agent', agent);
    if (exact) args.push('--exact');
    if (channel && to) args.push('--announce', '--channel', channel, '--to', to);

    console.log(`\n# ${job.name}`);
    console.log(`openclaw ${args.map((arg) => JSON.stringify(arg)).join(' ')}`);

    if (apply) {
      await run('openclaw', args);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
