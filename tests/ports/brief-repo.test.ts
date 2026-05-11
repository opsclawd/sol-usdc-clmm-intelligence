import { describe, it, expect } from "vitest";
import { FakeBriefRepo } from "../../tests/fakes/fake-brief-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const BRIEF_INSERT = {
  signalClass: "contextual" as const,
  confidence: DEFAULT_CONFIDENCE,
  provenance: DEFAULT_PROVENANCE
};

describe("ResearchBriefRepo contract", () => {
  it("inserts and finds by bundle id", async () => {
    const repo = new FakeBriefRepo();
    await repo.insert({
      ...BRIEF_INSERT,
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

  it("insert is idempotent by bundle+payloadHash", async () => {
    const repo = new FakeBriefRepo();
    const first = await repo.insert({
      ...BRIEF_INSERT,
      evidenceBundleId: 1,
      promptVersion: "v1",
      modelProvider: "claude-3.5-sonnet",
      structuredOutput: { summary: "test" },
      payloadHash: "dup1",
      receivedAtUnixMs: 1000
    });
    const second = await repo.insert({
      ...BRIEF_INSERT,
      evidenceBundleId: 1,
      promptVersion: "v1",
      modelProvider: "claude-3.5-sonnet",
      structuredOutput: { summary: "test" },
      payloadHash: "dup1",
      receivedAtUnixMs: 1000
    });
    expect(second.id).toBe(first.id);
  });

  it("findByHash returns existing row", async () => {
    const repo = new FakeBriefRepo();
    const inserted = await repo.insert({
      ...BRIEF_INSERT,
      evidenceBundleId: 1,
      promptVersion: "v1",
      modelProvider: "claude-3.5-sonnet",
      structuredOutput: { summary: "test" },
      payloadHash: "findme",
      receivedAtUnixMs: 1000
    });
    const found = await repo.findByHash(1, "findme");
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    const notFound = await repo.findByHash(1, "nope");
    expect(notFound).toBeUndefined();
  });
});
