import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { derivedFeatures } from "../../../src/db/schema/derived-features.js";
import { DrizzleFeatureRepo } from "../../../src/adapters/node/drizzle-feature-repo.js";
import { createDb } from "../../../src/db/db.js";
import type { Db } from "../../../src/db/db.js";
import type { DerivedFeatureInsert } from "../../../src/ports/feature-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../../helpers/taxonomy-fixtures.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const POOL_ID = "pool-integ-1";
const POSITION_ID = "position-integ-1";
const AS_OF_MS = 1_700_000_000_000;

function makeInsert(overrides: Partial<DerivedFeatureInsert> = {}): DerivedFeatureInsert {
  const suffix = `${Date.now()}-${Math.random()}`;
  return {
    featureKind: "range_location",
    signalClass: "deterministic",
    evidenceFamily: "clmm_state",
    value: 500000,
    structuredPayload: {},
    asOfUnixMs: AS_OF_MS,
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 1,
    confidenceLevel: "high",
    validUntilUnixMs: AS_OF_MS + 3_600_000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    payloadHash: `hash-${suffix}`,
    receivedAtUnixMs: AS_OF_MS,
    status: "AVAILABLE",
    unit: "PPM",
    pair: "SOL/USDC",
    calculatorVersion: "1.0.0",
    selectionVersion: "mvp-selection/v1",
    inputObservationIds: [],
    rejectedObservationIds: [],
    derivationKey: `dk-${suffix}`,
    poolId: null,
    positionId: null,
    warnings: [],
    reasons: [],
    ...overrides
  };
}

describe("DrizzleFeatureRepo integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let db: Db;
  let repo: DrizzleFeatureRepo;
  let client: ReturnType<typeof import("postgres")>;

  beforeAll(() => {
    const { db: database, client: pgClient } = createDb(TEST_DB_URL);
    db = database;
    client = pgClient;
    repo = new DrizzleFeatureRepo(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(derivedFeatures);
  });

  describe("listBundleCandidates", () => {
    it("includes pool/position-independent candidates (null poolId/positionId) alongside a specific poolId/positionId query", async () => {
      // Position-scoped candidate for the exact pool/position being queried.
      await repo.insert(
        makeInsert({
          featureKind: "range_location",
          poolId: POOL_ID,
          positionId: POSITION_ID
        })
      );
      // Pool-only candidate: scoped to the pool, but position-independent.
      await repo.insert(
        makeInsert({
          featureKind: "volume_liquidity_ratio_24h",
          unit: "BPS",
          poolId: POOL_ID,
          positionId: null
        })
      );
      // Fully pool/position-independent candidate (e.g. oracle_dex_divergence).
      await repo.insert(
        makeInsert({
          featureKind: "oracle_dex_divergence",
          unit: "BPS",
          poolId: null,
          positionId: null
        })
      );
      // Candidate scoped to a different pool/position entirely — must not match.
      await repo.insert(
        makeInsert({
          featureKind: "range_location",
          poolId: "other-pool",
          positionId: "other-position"
        })
      );

      const candidates = await repo.listBundleCandidates({
        featureKinds: ["range_location", "volume_liquidity_ratio_24h", "oracle_dex_divergence"],
        pair: "SOL/USDC",
        asOfAtOrAfterUnixMs: AS_OF_MS - 1000,
        asOfAtOrBeforeUnixMs: AS_OF_MS + 1000,
        receivedAtOrBeforeUnixMs: AS_OF_MS + 1000,
        poolId: POOL_ID,
        positionId: POSITION_ID
      });

      const kinds = candidates.map((c) => c.featureKind).sort();
      expect(kinds).toEqual(
        ["oracle_dex_divergence", "range_location", "volume_liquidity_ratio_24h"].sort()
      );
      expect(candidates.some((c) => c.poolId === "other-pool")).toBe(false);
    });
  });
});
