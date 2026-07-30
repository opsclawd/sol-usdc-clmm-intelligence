import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { CronConfig, CronJob } from "../../src/contracts/cron-config.js";
import { renderCronCommands } from "../../src/application/render-cron-commands.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

const PRE_EXISTING_JOB_NAMES = [
  "context-events",
  "news-evidence",
  "on-chain-flow",
  "perp-liquidation",
  "support-resistance"
];

async function loadCronConfig(): Promise<CronConfig> {
  const content = await readFile("cron/jobs.yaml", "utf8");
  return YAML.parse(content) as CronConfig;
}

async function loadUniqueJob(name: string): Promise<{ job: CronJob }> {
  const config = await loadCronConfig();
  const matches = config.jobs.filter((j) => j.name === name);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one job named '${name}', found ${matches.length}`);
  }
  return { job: matches[0]! };
}

function projectJobs(jobs: CronJob[], names: string[]): Array<[string, string, string]> {
  return jobs.filter((j) => names.includes(j.name)).map((j) => [j.name, j.cron, j.messageFile]);
}

describe("core evidence pipeline cron schedule regression", () => {
  it("declares exactly one core evidence pipeline job at the thirty-minute cadence", async () => {
    const { job } = await loadUniqueJob("core-evidence-pipeline");
    expect(job).toEqual({
      name: "core-evidence-pipeline",
      cron: "*/30 * * * *",
      messageFile: "cron/routines/core-evidence-pipeline.md"
    });
  });

  it("keeps the core evidence pipeline routine to one deterministic command", async () => {
    const routine = await readFile("cron/routines/core-evidence-pipeline.md", "utf8");
    expect(routine.trim()).toBe("Run `pnpm run:core-evidence-pipeline`.");
  });

  it("preserves every pre-existing research schedule", async () => {
    const { jobs } = await loadCronConfig();
    expect(projectJobs(jobs, PRE_EXISTING_JOB_NAMES)).toEqual([
      ["context-events", "0 */4 * * *", "cron/routines/context-events.md"],
      ["news-evidence", "0 */2 * * *", "cron/routines/news-evidence.md"],
      ["on-chain-flow", "0 * * * *", "cron/routines/on-chain-flow.md"],
      ["perp-liquidation", "*/5 * * * *", "cron/routines/perp-liquidation.md"],
      ["support-resistance", "15 */4 * * *", "cron/routines/support-resistance.md"]
    ]);
  });

  it("renders alongside a five-minute price observations job", async () => {
    const rawYaml = await readFile("cron/jobs.yaml", "utf8");
    const simulatedConfig = YAML.parse(rawYaml) as CronConfig;
    simulatedConfig.jobs.push({
      name: "price-observations",
      cron: "*/5 * * * *",
      messageFile: "cron/routines/price-observations.md"
    });

    const fakeTextReader = new FakeTextReader();
    fakeTextReader.seed("cron/jobs.synthetic.yaml", YAML.stringify(simulatedConfig));

    for (const job of simulatedConfig.jobs) {
      if (job.name === "price-observations") {
        fakeTextReader.seed(job.messageFile, "Run `pnpm collect:price-observations`.");
      } else {
        const content = await readFile(job.messageFile, "utf8");
        fakeTextReader.seed(job.messageFile, content);
      }
    }

    const fakeEnv = new FakeEnv();
    const lines = await renderCronCommands({
      textReader: fakeTextReader,
      env: fakeEnv,
      configPath: "cron/jobs.synthetic.yaml"
    });

    const coreLine = lines.find((line) => line.includes("--name 'core-evidence-pipeline'"));
    const priceLine = lines.find((line) => line.includes("--name 'price-observations'"));

    expect(coreLine).toBeDefined();
    expect(priceLine).toBeDefined();
    expect(coreLine).toContain("hermes cron create '*/30 * * * *'");
    expect(coreLine).toContain("--name 'core-evidence-pipeline'");
    expect(coreLine).toContain("pnpm run:core-evidence-pipeline");
    expect(priceLine).toContain("hermes cron create '*/5 * * * *'");
    expect(priceLine).toContain("--name 'price-observations'");
    expect(lines).toHaveLength(new Set(simulatedConfig.jobs.map(({ name }) => name)).size);
    expect(lines.every((line) => line.includes("Working directory for this task:"))).toBe(true);
  });
});
