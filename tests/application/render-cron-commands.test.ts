import { describe, expect, it } from "vitest";
import { renderCronCommands } from "../../src/application/render-cron-commands.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

const yaml = `
timezone: UTC
session: isolated
workingDirectory: /opt/apps/sol-usdc-clmm-intelligence
modelEnv: OPENCLAW_MODEL
jobs:
  - name: a
    cron: "0 7 * * *"
    messageFile: r.md
`;

describe("renderCronCommands", () => {
  it('returns a shell-quoted line per job that begins with "hermes cron create"', async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "Multi'line\nmessage");
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });
    const lines = await renderCronCommands({ textReader, env });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hermes cron create ");
    expect(lines[0]).toContain("'0 7 * * *'");
    expect(lines[0]).toContain(
      "Working directory for this task: /opt/apps/sol-usdc-clmm-intelligence"
    );
    expect(lines[0]).toContain("Multi'\"'\"'line\nmessage");
    expect(lines[0]).toContain("--name 'a'");
    expect(lines[0]).toContain("--deliver 'local'");
    expect(lines[0]).not.toContain("--model");
    expect(lines[0]).not.toContain("--tz");
    expect(lines[0]).not.toContain("--session");
  });
});
