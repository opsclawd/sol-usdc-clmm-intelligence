import { describe, it, expect } from "vitest";
import { FakeNormalizedObservationRepo } from "../../tests/fakes/fake-normalized-observation-repo.js";

describe("NormalizedObservationRepo contract", () => {
  it("inserts and finds by source and kind", async () => {
    const repo = new FakeNormalizedObservationRepo();
    const row = await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 150.0 },
      payloadHash: "hash-norm-1",
      receivedAtUnixMs: 1000
    });
    expect(row.id).toBe(1);

    const found = await repo.findBySource("clmm-v2-bundle", "pool-snapshot", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.observationKind).toBe("pool-snapshot");
  });

  it("findFreshByKind returns only fresh observations", async () => {
    const repo = new FakeNormalizedObservationRepo();
    await repo.insert({
      rawObservationId: 1,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 150.0 },
      payloadHash: "hash-1",
      isFresh: true,
      receivedAtUnixMs: 1000
    });
    await repo.insert({
      rawObservationId: 2,
      source: "clmm-v2-bundle",
      observationKind: "pool-snapshot",
      payload: { price: 148.0 },
      payloadHash: "hash-2",
      isFresh: false,
      receivedAtUnixMs: 1100
    });

    const fresh = await repo.findFreshByKind("clmm-v2-bundle", "pool-snapshot");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.isFresh).toBe(true);
  });
});
