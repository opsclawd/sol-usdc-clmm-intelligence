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

function projectJobs(jobs: CronJob[], names: string[]): Array<[string, string, string]> {
  return jobs.filter((j) => names.includes(j.name)).map((j) => [j.name, j.cron, j.messageFile]);
}

describe("core evidence pipeline cron schedule regression", () => {
  it("registers core-evidence-pipeline in canonical cron/jobs.yaml at the thirty-minute cadence", async () => {
    const config = await loadCronConfig();
    const matches = config.jobs.filter((j) => j.name === "core-evidence-pipeline");
    expect(matches).toEqual([
      {
        name: "core-evidence-pipeline",
        cron: "*/30 * * * *",
        messageFile: "cron/routines/core-evidence-pipeline.md"
      }
    ]);
  });

  it("declares the synthetic core evidence pipeline job configuration at the thirty-minute cadence", () => {
    const syntheticJob: CronJob = {
      name: "core-evidence-pipeline",
      cron: "*/30 * * * *",
      messageFile: "cron/routines/core-evidence-pipeline.md"
    };
    expect(syntheticJob).toEqual({
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
      ["on-chain-flow", "*/15 * * * *", "cron/routines/on-chain-flow.md"],
      ["perp-liquidation", "*/5 * * * *", "cron/routines/perp-liquidation.md"],
      ["support-resistance", "15 */4 * * *", "cron/routines/support-resistance.md"]
    ]);
  });

  it("renders the canonical five-minute sampler alongside the core pipeline", async () => {
    const rawYaml = await readFile("cron/jobs.yaml", "utf8");
    const config = YAML.parse(rawYaml) as CronConfig;

    const fakeTextReader = new FakeTextReader();
    fakeTextReader.seed("cron/jobs.yaml", rawYaml);

    for (const job of config.jobs) {
      const content = await readFile(job.messageFile, "utf8");
      fakeTextReader.seed(job.messageFile, content);
    }

    const fakeEnv = new FakeEnv();
    const lines = await renderCronCommands({
      textReader: fakeTextReader,
      env: fakeEnv
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
    expect(priceLine).toContain("pnpm collect:price");
    expect(lines).toHaveLength(new Set(config.jobs.map(({ name }) => name)).size);
    expect(lines.every((line) => line.includes("Working directory for this task:"))).toBe(true);
  });
});
