import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadCronConfig } from "../../src/application/load-cron-config.js";
import { renderSystemCron } from "../../src/application/render-system-cron.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

describe("cron-render regression", () => {
  it("matches the captured render output", async () => {
    const yaml = await readFile("tests/fixtures/cron/jobs.yaml", "utf8");
    const routine = await readFile("tests/fixtures/cron/routines/daily.md", "utf8");
    const textReader = new FakeTextReader();
    textReader.seed("tests/fixtures/cron/jobs.yaml", yaml);
    textReader.seed("tests/fixtures/cron/routines/daily.md", routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });

    const config = await loadCronConfig({
      textReader,
      env,
      configPath: "tests/fixtures/cron/jobs.yaml"
    });
    const lines = renderSystemCron(config);
    const expected = (await readFile("tests/fixtures/expected/cron-render.txt", "utf8")).trimEnd();
    expect(lines.join("\n")).toBe(expected);
  });

  it("renders the five-minute perp liquidation routine with the bounded collector command", async () => {
    const yaml = await readFile("tests/fixtures/cron/perp-liquidation-jobs.yaml", "utf8");
    const routine = await readFile("cron/routines/perp-liquidation.md", "utf8");
    const textReader = new FakeTextReader();
    textReader.seed("tests/fixtures/cron/perp-liquidation-jobs.yaml", yaml);
    textReader.seed("cron/routines/perp-liquidation.md", routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });

    const config = await loadCronConfig({
      textReader,
      env,
      configPath: "tests/fixtures/cron/perp-liquidation-jobs.yaml"
    });
    const lines = renderSystemCron(config);
    expect(lines).toContain("# BEGIN SOL-USDC CRON");
    expect(lines).toContain(
      "*/5 * * * * cd /opt/apps/sol-usdc-clmm-intelligence && source .env && pnpm collect:perp-liquidation >> cron/output/perp-liquidation.log 2>&1"
    );
  });
});
