import { describe, it, expect } from "vitest";
import { FakeBundleRepo } from "../../tests/fakes/fake-bundle-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

const BUNDLE_INSERT = {
  confidence: DEFAULT_CONFIDENCE,
  provenance: DEFAULT_PROVENANCE
};

describe("EvidenceBundleRepo contract", () => {
  it("inserts and finds by pair", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      ...BUNDLE_INSERT,
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC" },
      payloadHash: "hash-bundle-1",
      payloadCanonical: "canonical-1",
      idempotencyKey: "idem-1",
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByPair("SOL/USDC", 500);
    expect(found).toHaveLength(1);
  });

  it("findLatestByPair returns the most recent", async () => {
    const repo = new FakeBundleRepo();
    await repo.insert({
      ...BUNDLE_INSERT,
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC", v: 1 },
      payloadHash: "hash-1",
      payloadCanonical: "canonical-1",
      idempotencyKey: "idem-1",
      receivedAtUnixMs: 1001
    });
    await repo.insert({
      ...BUNDLE_INSERT,
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1500,
      expiresAtUnixMs: 2500,
      payload: { pair: "SOL/USDC", v: 2 },
      payloadHash: "hash-2",
      payloadCanonical: "canonical-2",
      idempotencyKey: "idem-2",
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

  it("insert is idempotent by schemaVersion, pair, and idempotencyKey, ignoring payloadHash", async () => {
    const repo = new FakeBundleRepo();
    const first = await repo.insert({
      ...BUNDLE_INSERT,
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC" },
      payloadHash: "hash-1",
      payloadCanonical: "canonical-1",
      idempotencyKey: "idem-dup",
      receivedAtUnixMs: 1001
    });

    const second = await repo.insert({
      ...BUNDLE_INSERT,
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      asOfUnixMs: 1000,
      expiresAtUnixMs: 2000,
      payload: { pair: "SOL/USDC" },
      payloadHash: "hash-2", // different payloadHash
      payloadCanonical: "canonical-2",
      idempotencyKey: "idem-dup", // same idempotencyKey
      receivedAtUnixMs: 1002
    });

    expect(second.id).toBe(first.id);
    expect(second.payloadHash).toBe("hash-1");
  });
});
