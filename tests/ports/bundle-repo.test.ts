import { describe, it, expect } from "vitest";
import { FakeBundleRepo } from "../../tests/fakes/fake-bundle-repo.js";

describe("EvidenceBundleRepo contract", () => {
  it("inserts and finds by pair", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC" },
      payloadHash: "hash-bundle-1",
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByPair("SOL/USDC", 500);
    expect(found).toHaveLength(1);
  });

  it("findLatestByPair returns the most recent", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC", v: 1 },
      payloadHash: "hash-1",
      receivedAtUnixMs: 1001
    });
    await repo.insert({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1500,
      expiresAtUnixMs: 2500,
      payload: { pair: "SOL/USDC", v: 2 },
      payloadHash: "hash-2",
      receivedAtUnixMs: 1501
    });

    const latest = await repo.findLatestByPair("SOL/USDC");
    expect(latest).toBeDefined();
    expect(latest!.receivedAtUnixMs).toBe(1501);
  });

  it("findLatestByPair returns undefined when no bundles exist", async () => {
    const repo = new FakeBundleRepo();
    const latest = await repo.findLatestByPair("SOL/USDC");
    expect(latest).toBeUndefined();
  });
});
