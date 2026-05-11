import { describe, it, expect } from "vitest";
import { FakeFeatureRepo } from "../../tests/fakes/fake-feature-repo.js";

describe("DerivedFeatureRepo contract", () => {
  it("inserts and finds by kind", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.15,
      asOfUnixMs: 1000,
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee-apr", 900);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.15);
  });

  it("findByKind filters by sinceUnixMs", async () => {
    const repo = new FakeFeatureRepo();
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.15,
      asOfUnixMs: 500,
      receivedAtUnixMs: 501
    });
    await repo.insert({
      featureKind: "fee-apr",
      value: 0.2,
      asOfUnixMs: 1000,
      receivedAtUnixMs: 1001
    });

    const found = await repo.findByKind("fee-apr", 800);
    expect(found).toHaveLength(1);
    expect(found[0]!.value).toBe(0.2);
  });
});
