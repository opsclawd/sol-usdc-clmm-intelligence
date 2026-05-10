import { describe, expect, it } from "vitest";
import { loadCronConfig } from "../../src/application/load-cron-config.js";
import { FakeTextReader, FakeEnv } from "../fakes/index.js";

const yaml = `
timezone: America/Edmonton
session: isolated
modelEnv: OPENCLAW_MODEL
thinkingEnv: OPENCLAW_THINKING
agentEnv: OPENCLAW_AGENT
exactEnv: OPENCLAW_EXACT
delivery:
  channelEnv: OPENCLAW_DELIVERY_CHANNEL
  toEnv: OPENCLAW_DELIVERY_TO
jobs:
  - name: clmm-daily
    cron: "0 7 * * *"
    messageFile: routines/daily.md
`;

describe("loadCronConfig", () => {
  it("parses YAML, resolves env defaults, and reads message files via the TextReader port", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("routines/daily.md", "Daily routine.");
    const env = new FakeEnv({
      OPENCLAW_MODEL: "opus",
      OPENCLAW_THINKING: "high",
      OPENCLAW_AGENT: "claude",
      OPENCLAW_EXACT: "true",
      OPENCLAW_DELIVERY_CHANNEL: "telegram",
      OPENCLAW_DELIVERY_TO: "12345"
    });

    const result = await loadCronConfig({ textReader, env });

    expect(result.defaults).toEqual({
      timezone: "America/Edmonton",
      session: "isolated",
      defaultModel: "opus",
      defaultThinking: "high",
      agent: "claude",
      exact: true,
      delivery: { channel: "telegram", to: "12345" }
    });
    expect(result.preparedJobs).toHaveLength(1);
    expect(result.preparedJobs[0]?.message).toBe("Daily routine.");
    expect(result.preparedJobs[0]?.job.name).toBe("clmm-daily");
  });

  it("omits delivery when only channel is set without to", async () => {
    const textReader = new FakeTextReader();
    textReader.seed("cron/jobs.yaml", yaml);
    textReader.seed("routines/daily.md", "m");
    const env = new FakeEnv({
      OPENCLAW_DELIVERY_CHANNEL: "telegram"
    });
    const result = await loadCronConfig({ textReader, env });
    expect(result.defaults.delivery).toBeUndefined();
    expect(result.defaults.exact).toBe(false);
  });
});
