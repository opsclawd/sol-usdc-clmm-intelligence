import { describe, expect, it } from "vitest";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import { loadValidFixture } from "../fixtures/evidence-bundle.js";
import { DETERMINISTIC_SUBFAMILY_IDS } from "../../src/domain/evidence-bundle/liveness.js";

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

/**
 * The canonical fixture carries only the seven original family keys. The six
 * deterministic sub-families are added here rather than by editing
 * `fixtures/valid/liveness.json`: vendored assets mirror regime-engine
 * byte-for-byte and are hash-verified against provenance.json, so mutating one
 * to satisfy a test breaks ASSET_HASH_MISMATCH for every other test.
 */
async function bundleWithSubfamilyLiveness(): Promise<unknown> {
  const fixture = (await loadValidFixture("liveness")) as {
    assessment: { liveness: Record<string, unknown> };
  };
  const bundle = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
  for (const id of DETERMINISTIC_SUBFAMILY_IDS) {
    bundle.assessment.liveness[id] = {
      isConfigured: true,
      lastCollectedAt: "2024-01-15T10:00:00.000Z"
    };
  }
  return bundle;
}

describe("canonical deterministic sub-family liveness contract", () => {
  it("accepts a bundle carrying all 13 liveness keys", async () => {
    const bundle = (await bundleWithSubfamilyLiveness()) as {
      assessment: { liveness: object };
    };

    expect(Object.keys(bundle.assessment.liveness).sort()).toEqual(EXPECTED_LIVENESS_KEYS);
    await expect(
      createEvidenceBundleContract().validateCanonicalizeAndHash(bundle)
    ).resolves.toMatchObject({ schemaVersion: "evidence-bundle.v1" });
  });

  it("still accepts the unmodified canonical fixture, which omits the sub-families", async () => {
    const fixture = await loadValidFixture("liveness");
    await expect(
      createEvidenceBundleContract().validateCanonicalizeAndHash(fixture)
    ).resolves.toMatchObject({ schemaVersion: "evidence-bundle.v1" });
  });
});
