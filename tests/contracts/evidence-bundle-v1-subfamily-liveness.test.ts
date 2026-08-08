import { describe, expect, it } from "vitest";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import { loadValidFixture } from "../fixtures/evidence-bundle.js";

const EXPECTED_LIVENESS_KEYS = [
  "clmm_economics",
  "derivatives",
  "deterministic",
  "events",
  "flows",
  "liquidity",
  "market_state",
  "newsRegulatory",
  "position_state",
  "price_quality",
  "researchBrief",
  "risk",
  "supportResistance"
].sort();

describe("canonical deterministic sub-family liveness contract", () => {
  it("accepts the canonical fixture with all 13 liveness keys", async () => {
    const fixture = await loadValidFixture("liveness");
    const liveness = (fixture as { assessment: { liveness: object } }).assessment.liveness;

    expect(Object.keys(liveness).sort()).toEqual(EXPECTED_LIVENESS_KEYS);
    await expect(
      createEvidenceBundleContract().validateCanonicalizeAndHash(fixture)
    ).resolves.toMatchObject({ schemaVersion: "evidence-bundle.v1" });
  });
});
