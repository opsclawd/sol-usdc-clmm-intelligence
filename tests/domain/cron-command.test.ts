import { describe, expect, it } from "vitest";
import { buildCronAddArgs } from "../../src/application/cron-command.js";

describe("buildCronAddArgs", () => {
  it("builds the minimal argv set when no defaults or delivery are present", () => {
    const result = buildCronAddArgs({
      job: { name: "clmm-daily", cron: "0 7 * * *", messageFile: "r.md" },
      message: "hello",
      timezone: "America/Edmonton",
      session: "isolated",
      exact: false
    });
    expect(result.command).toBe("openclaw");
    expect(result.args).toEqual([
      "cron",
      "add",
      "--name",
      "clmm-daily",
      "--cron",
      "0 7 * * *",
      "--tz",
      "America/Edmonton",
      "--session",
      "isolated",
      "--message",
      "hello"
    ]);
  });

  it("appends model and thinking when set on job", () => {
    const result = buildCronAddArgs({
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
      exact: false
    });
    expect(result.args).toContain("--model");
    expect(result.args).toContain("opus");
    expect(result.args).toContain("--thinking");
    expect(result.args).toContain("high");
  });

  it("falls back to default model and thinking when job lacks them", () => {
    const result = buildCronAddArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      exact: false,
      defaultModel: "sonnet",
      defaultThinking: "medium"
    });
    expect(result.args).toContain("--model");
    expect(result.args).toContain("sonnet");
    expect(result.args).toContain("--thinking");
    expect(result.args).toContain("medium");
  });

  it("appends agent and exact flags when present", () => {
    const result = buildCronAddArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      exact: true,
      agent: "claude"
    });
    expect(result.args).toContain("--agent");
    expect(result.args).toContain("claude");
    expect(result.args).toContain("--exact");
  });

  it("appends announce/channel/to when both delivery values are present", () => {
    const result = buildCronAddArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      exact: false,
      delivery: { channel: "telegram", to: "12345" }
    });
    expect(result.args).toEqual(
      expect.arrayContaining(["--announce", "--channel", "telegram", "--to", "12345"])
    );
  });

  it("does not append delivery flags when partial delivery is provided", () => {
    const result = buildCronAddArgs({
      job: { name: "a", cron: "* * * * *", messageFile: "r.md" },
      message: "m",
      timezone: "UTC",
      session: "isolated",
      exact: false,
      delivery: { channel: "telegram", to: "" }
    });
    expect(result.args).not.toContain("--announce");
  });
});
