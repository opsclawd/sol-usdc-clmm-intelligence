import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderCronCommands } from "../../src/application/render-cron-commands.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

describe("cron-render regression", () => {
  it("matches the captured render output", async () => {
    const yaml = await readFile("tests/fixtures/cron/jobs.yaml", "utf8");
    const routine = await readFile("tests/fixtures/cron/routines/daily.md", "utf8");
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("tests/fixtures/cron/routines/daily.md", routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });

    const lines = await renderCronCommands({ textReader, env });
    const expected = (await readFile("tests/fixtures/expected/cron-render.txt", "utf8")).trimEnd();
    expect(lines.join("\n")).toBe(expected);
  });

  it("renders the five-minute perp liquidation routine with the bounded collector command", async () => {
    const yaml = await readFile("tests/fixtures/cron/perp-liquidation-jobs.yaml", "utf8");
    const routine = await readFile("tests/fixtures/cron/routines/perp-liquidation.md", "utf8");
    const textReader = new FakeTextReader();
    textReader.seed("tests/fixtures/cron/perp-liquidation-jobs.yaml", yaml);
    textReader.seed("cron/routines/perp-liquidation.md", routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });

    const lines = await renderCronCommands({
      textReader,
      env,
      configPath: "tests/fixtures/cron/perp-liquidation-jobs.yaml"
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--name 'perp-liquidation'");
    expect(lines[0]).toContain("--cron '*/5 * * * *'");
    expect(lines[0]).toContain("pnpm collect:perp-liquidation");
  });
});
