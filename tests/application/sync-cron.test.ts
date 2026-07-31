import { describe, expect, it } from "vitest";
import { syncCron } from "../../src/application/sync-cron.js";
import { FakeTextReader, FakeEnv, FakeCommandRunner } from "../fakes/index.js";

const HOME = "/home/hermes";
const DEFAULT_JOBS_PATH = `${HOME}/.hermes/cron/jobs.json`;

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

function seedCronInputs(
  textReader: FakeTextReader,
  jobs: Array<{ id: string; name: string; extra?: string }>
): void {
  textReader.seed("cron/jobs.yaml", yaml);
  textReader.seed("r.md", "msg");
  textReader.seed(DEFAULT_JOBS_PATH, JSON.stringify({ jobs }));
}

describe("syncCron", () => {
  it("edits an existing Hermes job by id instead of creating a duplicate", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, [{ id: "existing-a", name: "a", extra: "ignored" }]);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    const result = await syncCron({ textReader, env, commandRunner, apply: false });

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toEqual({
      command: "hermes",
      args: [
        "cron",
        "edit",
        "existing-a",
        "--prompt",
        "Working directory for this task: /opt/apps/sol-usdc-clmm-intelligence — run all shell commands from there (cd into it first).\n\nmsg",
        "--schedule",
        "0 7 * * *",
        "--deliver",
        "local"
      ]
    });
    expect(result.commands[1]).toEqual({
      command: "hermes",
      args: [
        "cron",
        "create",
        "0 18 * * 0",
        "Working directory for this task: /opt/apps/sol-usdc-clmm-intelligence — run all shell commands from there (cd into it first).\n\nmsg",
        "--name",
        "b",
        "--deliver",
        "local"
      ]
    });
  });

  it("creates a desired job that is absent from the Hermes job store", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, []);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    const result = await syncCron({ textReader, env, commandRunner, apply: false });

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]?.args.slice(0, 2)).toEqual(["cron", "create"]);
    expect(result.commands[1]?.args.slice(0, 2)).toEqual(["cron", "create"]);
  });

  it("returns the reconciled command plan without invoking Hermes when apply is false", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, [{ id: "existing-a", name: "a", extra: "ignored" }]);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    const result = await syncCron({ textReader, env, commandRunner, apply: false });

    expect(result.apply).toBe(false);
    expect(result.commands).toHaveLength(2);
    expect(commandRunner.calls).toEqual([]);
  });

  it("applies edit and create commands sequentially in desired job order", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, [{ id: "existing-a", name: "a" }]);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    await syncCron({ textReader, env, commandRunner, apply: true });

    expect(commandRunner.calls).toHaveLength(2);
    expect(commandRunner.calls[0]?.command).toBe("hermes");
    expect(commandRunner.calls[0]?.args.slice(0, 3)).toEqual(["cron", "edit", "existing-a"]);
    expect(commandRunner.calls[1]?.command).toBe("hermes");
    expect(commandRunner.calls[1]?.args.slice(0, 2)).toEqual(["cron", "create"]);
  });

  it("aborts before mutation when the Hermes job store is unreadable or malformed", async () => {
    const malformedContents = [
      null,
      "invalid json",
      JSON.stringify({}),
      JSON.stringify({ jobs: "not-an-array" }),
      JSON.stringify({ jobs: [{ id: "", name: "a" }] }),
      JSON.stringify({ jobs: [{ name: "a" }] }),
      JSON.stringify({ jobs: [{ id: "123", name: "   " }] }),
      JSON.stringify({ jobs: [{ id: "123" }] })
    ];

    for (const content of malformedContents) {
      const textReader = new FakeTextReader();
      textReader.seed("cron/jobs.yaml", yaml);
      textReader.seed("r.md", "msg");
      if (content !== null) {
        textReader.seed(DEFAULT_JOBS_PATH, content);
      }
      const env = new FakeEnv({ HOME });
      const commandRunner = new FakeCommandRunner();

      await expect(syncCron({ textReader, env, commandRunner, apply: true })).rejects.toThrow();
      expect(commandRunner.calls).toEqual([]);
    }
  });

  it("aborts before mutation when a persisted job name has duplicate ids", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "msg");
    textReader.seed(
      DEFAULT_JOBS_PATH,
      JSON.stringify({
        jobs: [
          { id: "id-1", name: "a" },
          { id: "id-2", name: "a" }
        ]
      })
    );
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    await expect(syncCron({ textReader, env, commandRunner, apply: true })).rejects.toThrow(
      "duplicate job name"
    );
    expect(commandRunner.calls).toEqual([]);
  });

  it("rejects a relative Hermes job store path before reconciliation", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("r.md", "msg");
    const env = new FakeEnv({ HOME, HERMES_JOBS_FILE_PATH: "relative/jobs.json" });
    const commandRunner = new FakeCommandRunner();

    await expect(syncCron({ textReader, env, commandRunner, apply: true })).rejects.toThrow(
      "HERMES_JOBS_FILE_PATH must be an absolute path"
    );
    expect(commandRunner.calls).toEqual([]);
  });

  it("defaults the Hermes job store to the current HOME directory", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, [{ id: "existing-a", name: "a" }]);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();

    const defaultResult = await syncCron({ textReader, env, commandRunner, apply: false });
    expect(defaultResult.commands[0]?.args.slice(0, 3)).toEqual(["cron", "edit", "existing-a"]);

    const customReader = new FakeTextReader();
    customReader.seed("cron/jobs.yaml", yaml);
    customReader.seed("r.md", "msg");
    customReader.seed(
      "/srv/hermes/jobs.json",
      JSON.stringify({ jobs: [{ id: "custom-a", name: "a" }] })
    );
    const customEnv = new FakeEnv({ HOME, HERMES_JOBS_FILE_PATH: "/srv/hermes/jobs.json" });
    const customRunner = new FakeCommandRunner();

    const customResult = await syncCron({
      textReader: customReader,
      env: customEnv,
      commandRunner: customRunner,
      apply: false
    });
    expect(customResult.commands[0]?.args.slice(0, 3)).toEqual(["cron", "edit", "custom-a"]);
  });

  it("stops applying commands after the first Hermes failure", async () => {
    const textReader = new FakeTextReader();
    seedCronInputs(textReader, [{ id: "existing-a", name: "a" }]);
    const env = new FakeEnv({ HOME });
    const commandRunner = new FakeCommandRunner();
    const failure = new Error("Command failed");
    commandRunner.shouldFailWith = failure;

    await expect(syncCron({ textReader, env, commandRunner, apply: true })).rejects.toThrow(
      failure
    );
    expect(commandRunner.calls).toHaveLength(1);
  });
});
