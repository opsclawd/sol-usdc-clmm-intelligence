import { describe, it, expect } from "vitest";
import { FakeBriefRepo } from "../../tests/fakes/fake-brief-repo.js";

describe("ResearchBriefRepo contract", () => {
  it("inserts and finds by bundle id", async () => {
    const repo = new FakeBriefRepo();
    await repo.insert({
      evidenceBundleId: 1,
      promptVersion: "v1",
      modelProvider: "claude-3.5-sonnet",
      structuredOutput: { summary: "test" },
      payloadHash: "hash-brief-1",
      receivedAtUnixMs: 1000
    });

    const found = await repo.findByBundleId(1);
    expect(found).toHaveLength(1);
    expect(found[0]!.modelProvider).toBe("claude-3.5-sonnet");
  });

  it("findByBundleId returns empty for non-existent bundle", async () => {
    const repo = new FakeBriefRepo();
    const found = await repo.findByBundleId(999);
    expect(found).toHaveLength(0);
  });
});
