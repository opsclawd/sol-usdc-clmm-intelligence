import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { CronConfig, CronJob } from "../../src/contracts/cron-config.js";
import { DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS } from "../../src/domain/on-chain-flow/defaults.js";

function fixedMinuteIntervalMs(expression: string): number {
  const match = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(expression);
  if (!match) throw new Error(`Expected fixed-minute cron expression, received: ${expression}`);
  return Number(match[1]) * 60_000;
}

async function loadOnChainFlowJob(): Promise<CronJob> {
  const config = YAML.parse(await readFile("cron/jobs.yaml", "utf8")) as CronConfig;
  const matches = config.jobs.filter(({ name }) => name === "on-chain-flow");
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("on-chain-flow schedule regression", () => {
  it("registers exactly one on-chain-flow job every fifteen minutes", async () => {
    expect(await loadOnChainFlowJob()).toEqual({
      name: "on-chain-flow",
      cron: "*/15 * * * *",
      command: "pnpm collect:on-chain-flow"
    });
  });

  it("keeps the default lookback at least as long as the on-chain-flow schedule interval", async () => {
    const intervalMs = fixedMinuteIntervalMs((await loadOnChainFlowJob()).cron);
    expect(DEFAULT_ON_CHAIN_FLOW_LOOKBACK_MS).toBeGreaterThanOrEqual(intervalMs);
  });
});
