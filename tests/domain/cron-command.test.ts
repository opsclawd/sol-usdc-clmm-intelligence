import { describe, expect, it } from "vitest";
import { buildCronCreateArgs } from "../../src/application/cron-command.js";

const WORKING_DIRECTORY = "/opt/apps/sol-usdc-clmm-intelligence";

describe("buildCronCreateArgs", () => {
  it("builds the minimal argv set when no delivery is present", () => {
    const result = buildCronCreateArgs({
      job: { name: "clmm-daily", cron: "0 7 * * *", messageFile: "r.md" },
      message: "hello",
      timezone: "America/Edmonton",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: false
    });
    expect(result.command).toBe("hermes");
    expect(result.args).toEqual([
      "cron",
      "create",
      "0 7 * * *",
      `Working directory for this task: ${WORKING_DIRECTORY} — run all shell commands from there (cd into it first).\n\nhello`,
      "--name",
      "clmm-daily",
      "--deliver",
      "local"
    ]);
  });

  it("ignores job-level model/thinking — Hermes has no per-job model override", () => {
    const result = buildCronCreateArgs({
      job: {
        name: "a",
        cron: "* * * * *",
        messageFile: "r.md",
        model: "opus",
        thinking: "high"
      },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: false
    });
    expect(result.args).not.toContain("--model");
    expect(result.args).not.toContain("--thinking");
  });

  it("ignores defaultModel/defaultThinking/agent/exact — no Hermes equivalent", () => {
    const result = buildCronCreateArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: true,
      defaultModel: "sonnet",
      defaultThinking: "medium",
      agent: "claude"
    });
    expect(result.args).not.toContain("--model");
    expect(result.args).not.toContain("--thinking");
    expect(result.args).not.toContain("--agent");
    expect(result.args).not.toContain("--exact");
  });

  it("prefixes the prompt with a working-directory instruction", () => {
    const result = buildCronCreateArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "do the thing",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: "/opt/apps/example",
      exact: false
    });
    const prompt = result.args[3]!;
    expect(prompt.startsWith("Working directory for this task: /opt/apps/example")).toBe(true);
    expect(prompt.endsWith("do the thing")).toBe(true);
  });

  it("formats delivery as channel:to when both delivery values are present", () => {
    const result = buildCronCreateArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: false,
      delivery: { channel: "telegram", to: "12345" }
    });
    expect(result.args).toEqual(expect.arrayContaining(["--deliver", "telegram:12345"]));
  });

  it("falls back to --deliver local when partial delivery is provided", () => {
    const result = buildCronCreateArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: false,
      delivery: { channel: "telegram", to: "" }
    });
    expect(result.args).toEqual(expect.arrayContaining(["--deliver", "local"]));
  });

  it("falls back to --deliver local when no delivery is configured", () => {
    const result = buildCronCreateArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      workingDirectory: WORKING_DIRECTORY,
      exact: false
    });
    expect(result.args).toEqual(expect.arrayContaining(["--deliver", "local"]));
  });
});
