import { describe, it, expect } from "vitest";
import { FakeObservationRepo } from "../../tests/fakes/fake-observation-repo.js";
import { canonicalHash } from "../../src/domain/content-hash.js";

describe("RawObservationRepo contract", () => {
  it("inserts and finds by hash", async () => {
    const repo = new FakeObservationRepo();
    const hash = await canonicalHash({ test: "data" });
    const row = await repo.insert({
      source: "clmm-v2-bundle",
      sourceObservationKey: "obs-key-1",
      observedAtUnixMs: 1000,
      fetchedAtUnixMs: 1001,
      payloadHash: hash,
      payloadCanonical: '{"test":"data"}',
      receivedAtUnixMs: 1002
    });
    expect(row.id).toBe(1);

    const found = await repo.findByHash("clmm-v2-bundle", hash);
    expect(found).toBeDefined();
    expect(found!.id).toBe(1);
  });

  it("insert is idempotent on duplicate source+payloadHash", async () => {
    const repo = new FakeObservationRepo();
    const row1 = await repo.insert({
      source: "clmm-v2-bundle",
      sourceObservationKey: "obs-key-dup",
      observedAtUnixMs: 1000,
      fetchedAtUnixMs: 1001,
      payloadHash: "hash-dup",
      payloadCanonical: "{}",
      receivedAtUnixMs: 1002
    });
    const row2 = await repo.insert({
      source: "clmm-v2-bundle",
      sourceObservationKey: "obs-key-dup",
      observedAtUnixMs: 2000,
      fetchedAtUnixMs: 2001,
      payloadHash: "hash-dup",
      payloadCanonical: "{}",
      receivedAtUnixMs: 2002
    });
    expect(row2.id).toBe(row1.id);
  });

  it("findBySource filters by source and since", async () => {
    const repo = new FakeObservationRepo();
    await repo.insert({
      source: "jupiter-price",
      sourceObservationKey: "obs-key-jup",
      observedAtUnixMs: 500,
      fetchedAtUnixMs: 501,
      payloadHash: "hash-1",
      payloadCanonical: "{}",
      receivedAtUnixMs: 502
    });
    await repo.insert({
      source: "clmm-v2-bundle",
      sourceObservationKey: "obs-key-clmm",
      observedAtUnixMs: 1000,
      fetchedAtUnixMs: 1001,
      payloadHash: "hash-2",
      payloadCanonical: "{}",
      receivedAtUnixMs: 1002
    });

    const results = await repo.findBySource("jupiter-price", 400);
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("jupiter-price");

    const empty = await repo.findBySource("jupiter-price", 600);
    expect(empty).toHaveLength(0);
  });
});
