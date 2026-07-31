import { z } from "zod";
import type { TextReader } from "../ports/text-reader.js";
import type { EnvReader } from "../ports/env.js";
import type { CommandRunner } from "../ports/command-runner.js";
import { buildCronCreateArgs, buildCronEditArgs, type CronCommand } from "./cron-command.js";
import { loadCronConfig } from "./load-cron-config.js";

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

const hermesJobStoreSchema = z.object({
  jobs: z.array(
    z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1)
      })
      .passthrough()
  )
});

function resolveHermesJobsFilePath(env: EnvReader): string {
  const configured = env.getOptional("HERMES_JOBS_FILE_PATH");
  const path = configured ?? `${env.get("HOME").replace(/\/+$/, "")}/.hermes/cron/jobs.json`;
  if (!path.startsWith("/")) {
    throw new Error("HERMES_JOBS_FILE_PATH must be an absolute path");
  }
  return path;
}

function parseHermesJobs(content: string): Map<string, string> {
  const parsed = hermesJobStoreSchema.parse(JSON.parse(content));
  const idsByName = new Map<string, string>();
  for (const job of parsed.jobs) {
    if (idsByName.has(job.name)) {
      throw new Error(`Hermes job store contains duplicate job name: ${job.name}`);
    }
    idsByName.set(job.name, job.id);
  }
  return idsByName;
}

export async function syncCron(deps: SyncCronDeps): Promise<SyncCronResult> {
  const { textReader, env, commandRunner, apply } = deps;
  const { defaults, preparedJobs } = await loadCronConfig({
    textReader,
    env,
    ...(deps.configPath ? { configPath: deps.configPath } : {})
  });

  const jobsFilePath = resolveHermesJobsFilePath(env);
  const idsByName = parseHermesJobs(await textReader.readText(jobsFilePath));
  const commands = preparedJobs.map((prepared) => {
    const jobId = idsByName.get(prepared.job.name);
    const inputs = {
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
    };
    return jobId ? buildCronEditArgs({ ...inputs, jobId }) : buildCronCreateArgs(inputs);
  });

  if (apply) {
    for (const cmd of commands) {
      await commandRunner.run(cmd.command, cmd.args);
    }
  }

  return { commands, apply };
}
