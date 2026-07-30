import type { CronJob } from "../contracts/cron-config.js";

export interface BuildCronCreateArgsInputs {
  job: CronJob;
  message: string;
  timezone: string;
  session: string;
  workingDirectory: string;
  exact: boolean;
  defaultModel?: string;
  defaultThinking?: string;
  agent?: string;
  delivery?: { channel: string; to: string };
}

export interface BuildCronEditArgsInputs extends BuildCronCreateArgsInputs {
  jobId: string;
}

export interface CronCommand {
  command: "hermes";
  args: string[];
}

const HERMES_CLI_PATH = ["cron", "create"] as const;

function buildDeliverTarget(delivery?: { channel: string; to: string }): string {
  return delivery && delivery.channel && delivery.to
    ? `${delivery.channel}:${delivery.to}`
    : "local";
}

function buildPrompt(message: string, workingDirectory: string): string {
  return `Working directory for this task: ${workingDirectory} — run all shell commands from there (cd into it first).\n\n${message}`;
}

/**
 * Hermes's `cron create` has no equivalent to OpenClaw's `--tz`, `--session`,
 * `--exact`, `--model`, `--thinking`, or `--agent` flags — Hermes uses a
 * single server-local timezone and a single globally-configured model for
 * all jobs. `timezone`, `session`, `exact`, `defaultModel`/`defaultThinking`,
 * and `agent` are accepted here (and still declared in `cron/jobs.yaml`) for
 * schema/documentation continuity, but intentionally produce no CLI args.
 */
export function buildCronCreateArgs(inputs: BuildCronCreateArgsInputs): CronCommand {
  const { job, message, delivery, workingDirectory } = inputs;

  const args: string[] = [
    ...HERMES_CLI_PATH,
    job.cron,
    buildPrompt(message, workingDirectory),
    "--name",
    job.name,
    "--deliver",
    buildDeliverTarget(delivery)
  ];

  return { command: "hermes", args };
}

export function buildCronEditArgs(inputs: BuildCronEditArgsInputs): CronCommand {
  const { jobId, job, message, delivery, workingDirectory } = inputs;

  return {
    command: "hermes",
    args: [
      "cron",
      "edit",
      jobId,
      "--prompt",
      buildPrompt(message, workingDirectory),
      "--schedule",
      job.cron,
      "--deliver",
      buildDeliverTarget(delivery)
    ]
  };
}
