import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { CronConfig, CronJob } from "../../src/contracts/cron-config.js";
import { loadCronConfig } from "../../src/application/load-cron-config.js";
import { renderSystemCron } from "../../src/application/render-system-cron.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";
import { getFeatureKindEntry } from "../../src/domain/taxonomy/index.js";

const PRE_EXISTING_JOB_NAMES = [
  "clmm-bundle",
  "context-events",
  "news-evidence",
  "on-chain-flow",
  "perp-liquidation",
  "price-observations",
  "support-resistance"
];

const PERP_FEATURE_KINDS = [
  "oi_trend_4h",
  "liquidation_cluster_1h",
  "funding_rate_annualized",
  "basis_spread_bps"
] as const;

function parseCronIntervalMs(expression: string): number {
  const minuteMatch = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(expression);
  if (minuteMatch) return Number(minuteMatch[1]) * 60_000;
  const hourMatch = /^0 \*\/([1-9]\d*) \* \* \*$/.exec(expression);
  if (hourMatch) return Number(hourMatch[1]) * 3_600_000;
  throw new Error(`Expected supported cron expression, received: ${expression}`);
}

async function loadRawCronConfig(): Promise<CronConfig> {
  const content = await readFile("cron/jobs.yaml", "utf8");
  return YAML.parse(content) as CronConfig;
}

function projectJobs(jobs: CronJob[], names: string[]): Array<[string, string, string]> {
  return jobs.filter((j) => names.includes(j.name)).map((j) => [j.name, j.cron, j.command]);
}

describe("core evidence pipeline cron schedule regression", () => {
  it("registers core-evidence-pipeline in canonical cron/jobs.yaml at the four-hour cadence", async () => {
    const config = await loadRawCronConfig();
    const matches = config.jobs.filter((j) => j.name === "core-evidence-pipeline");
    expect(matches).toEqual([
      {
        name: "core-evidence-pipeline",
        cron: "0 */4 * * *",
        command: "pnpm run:core-evidence-pipeline"
      }
    ]);
  });

  it("keeps the assembly interval within perp feature validity windows", async () => {
    const config = await loadRawCronConfig();
    const job = config.jobs.find(({ name }) => name === "core-evidence-pipeline");
    expect(job).toBeDefined();

    const intervalMs = parseCronIntervalMs(job!.cron);
    for (const kind of PERP_FEATURE_KINDS) {
      expect(getFeatureKindEntry(kind).freshnessPolicy.maxObservedAgeMs).toBeGreaterThanOrEqual(
        intervalMs
      );
    }
  });

  it("keeps the core evidence pipeline job to one deterministic command", async () => {
    // The command is declarative in jobs.yaml now; it used to be prose in a
    // routine markdown file that an agent read. The invariant is unchanged:
    // exactly one command, no scripting or chaining.
    const { jobs } = await loadRawCronConfig();
    const job = jobs.find((j) => j.name === "core-evidence-pipeline");
    expect(job?.command).toBe("pnpm run:core-evidence-pipeline");
    expect(job?.command).not.toMatch(/[;&|]/);
  });

  it("preserves every pre-existing research schedule", async () => {
    const { jobs } = await loadRawCronConfig();
    expect(projectJobs(jobs, PRE_EXISTING_JOB_NAMES)).toEqual([
      ["context-events", "0 */4 * * *", "pnpm collect:context-events"],
      ["news-evidence", "0 */2 * * *", "pnpm collect:news-evidence"],
      ["on-chain-flow", "*/15 * * * *", "pnpm collect:on-chain-flow"],
      ["perp-liquidation", "*/5 * * * *", "pnpm collect:perp-liquidation"],
      ["price-observations", "*/5 * * * *", "pnpm collect:price"],
      ["support-resistance", "15 */4 * * *", "pnpm collect:support-resistance"],
      ["clmm-bundle", "* * * * *", "pnpm collect:clmm-bundle"]
    ]);
  });

  it("renders the canonical four-hour core pipeline alongside the five-minute sampler", async () => {
    const rawYaml = await readFile("cron/jobs.yaml", "utf8");

    const fakeTextReader = new FakeTextReader();
    fakeTextReader.seed("cron/jobs.yaml", rawYaml);

    const fakeEnv = new FakeEnv();
    const loadedConfig = await loadCronConfig({
      textReader: fakeTextReader,
      env: fakeEnv
    });

    const lines = renderSystemCron(loadedConfig);

    expect(lines).toContain("# BEGIN SOL-USDC CRON");
    expect(lines.some((line) => line.includes("pnpm run:core-evidence-pipeline"))).toBe(true);
    expect(lines.some((line) => line.includes("pnpm collect:price"))).toBe(true);
  });
});
