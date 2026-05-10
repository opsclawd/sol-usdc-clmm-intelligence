export interface CronJob {
  name: string;
  cron: string;
  messageFile: string;
  description?: string;
  model?: string;
  thinking?: string;
}

export interface CronConfig {
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
  jobs: CronJob[];
}

export interface ResolvedCronDefaults {
  timezone: string;
  session: string;
  defaultModel?: string;
  defaultThinking?: string;
  agent?: string;
  exact: boolean;
  delivery?: {
    channel: string;
    to: string;
  };
}

export interface PreparedCronJob {
  job: CronJob;
  message: string;
  model?: string;
  thinking?: string;
}
