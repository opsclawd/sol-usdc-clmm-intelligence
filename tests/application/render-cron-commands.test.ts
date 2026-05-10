import { describe, expect, it } from "vitest";
import { renderCronCommands } from "../../src/application/render-cron-commands.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

const yaml = `
timezone: UTC
session: isolated
modelEnv: OPENCLAW_MODEL
jobs:
  - name: a
    cron: "0 7 * * *"
    messageFile: r.md
`;

describe("renderCronCommands", () => {
  it('returns a shell-quoted line per job that begins with "openclaw cron add"', async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "Multi'line\nmessage");
    const env = new FakeEnv({ OPENCLAW_MODEL: "opus" });
    const lines = await renderCronCommands({ textReader, env });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("openclaw cron add ");
    expect(lines[0]).toContain("--name 'a'");
    expect(lines[0]).toContain("--cron '0 7 * * *'");
    expect(lines[0]).toContain("--tz 'UTC'");
    expect(lines[0]).toContain("--session 'isolated'");
    expect(lines[0]).toContain("--model 'opus'");
    expect(lines[0]).toContain("--message 'Multi'\"'\"'line\nmessage'");
  });
});
