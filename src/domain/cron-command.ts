import type { CronJob } from '../contracts/cron-config.js';

export interface BuildCronAddArgsInputs {
  job: CronJob;
  message: string;
  timezone: string;
  session: string;
  exact: boolean;
  defaultModel?: string;
  defaultThinking?: string;
  agent?: string;
  delivery?: { channel: string; to: string };
}

export interface CronCommand {
  command: 'openclaw';
  args: string[];
}

export function buildCronAddArgs(inputs: BuildCronAddArgsInputs): CronCommand {
  const { job, message, timezone, session, exact, defaultModel, defaultThinking, agent, delivery } = inputs;
  const args: string[] = [
    'cron',
    'add',
    '--name', job.name,
    '--cron', job.cron,
    '--tz', timezone,
    '--session', session,
    '--message', message
  ];

  const model = job.model ?? defaultModel;
  const thinking = job.thinking ?? defaultThinking;
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (agent) args.push('--agent', agent);
  if (exact) args.push('--exact');
  if (delivery && delivery.channel && delivery.to) {
    args.push('--announce', '--channel', delivery.channel, '--to', delivery.to);
  }

  return { command: 'openclaw', args };
}