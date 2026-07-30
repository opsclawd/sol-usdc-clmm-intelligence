import { describe, expect, it } from "vitest";
import { syncCron } from "../../src/application/sync-cron.js";
import { FakeTextReader, FakeEnv, FakeCommandRunner } from "../fakes/index.js";

const yaml = `
timezone: UTC
session: isolated
workingDirectory: /opt/apps/sol-usdc-clmm-intelligence
jobs:
  - name: a
    cron: "0 7 * * *"
    messageFile: r.md
  - name: b
    cron: "0 18 * * 0"
    messageFile: r.md
    thinking: high
`;

describe("syncCron", () => {
  it("returns prepared commands without invoking the runner when apply is false", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "msg");
    const env = new FakeEnv({});
    const commandRunner = new FakeCommandRunner();

    const result = await syncCron({ textReader, env, commandRunner, apply: false });

    expect(result.commands).toHaveLength(2);
    expect(commandRunner.calls).toEqual([]);
    expect(result.commands[0]).toEqual({
      command: "hermes",
      args: expect.arrayContaining(["cron", "create", "0 7 * * *", "--name", "a"])
    });
    expect(result.commands[0]?.args).toEqual(
      expect.arrayContaining([expect.stringContaining("msg")])
    );
  });

  it("runs commandRunner with prepared argv when apply is true", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "msg");
    const env = new FakeEnv({});
    const commandRunner = new FakeCommandRunner();

    await syncCron({ textReader, env, commandRunner, apply: true });
    expect(commandRunner.calls).toHaveLength(2);
    expect(commandRunner.calls[0]?.command).toBe("hermes");
    expect(commandRunner.calls[0]?.args.slice(0, 2)).toEqual(["cron", "create"]);
  });
});
