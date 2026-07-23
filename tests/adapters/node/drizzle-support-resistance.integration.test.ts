import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, gte } from "drizzle-orm";
import { rawObservations } from "../../../src/db/schema/raw-observations.js";
import { normalizedObservations } from "../../../src/db/schema/normalized-observations.js";
import { DrizzleObservationRepo } from "../../../src/adapters/node/drizzle-observation-repo.js";
import { DrizzleNormalizedObservationRepo } from "../../../src/adapters/node/drizzle-normalized-observation-repo.js";
import { createDb } from "../../../src/db/db.js";
import type { Db } from "../../../src/db/db.js";
import type { Source } from "../../../src/contracts/taxonomy.js";
import type { SupportResistancePayloadV1 } from "../../../src/contracts/support-resistance.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../../helpers/taxonomy-fixtures.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const SOURCE: Source = "technical-analysis-api";

describe("DrizzleNormalizedObservationRepo support resistance integration", () => {
  if (!TEST_DB_URL) {
    it("skipping: TEST_DATABASE_URL not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let db: Db;
  let rawRepo: DrizzleObservationRepo;
  let normalizedRepo: DrizzleNormalizedObservationRepo;
  let client: ReturnType<typeof import("postgres")>;

  beforeAll(() => {
    const { db: database, client: pgClient } = createDb(TEST_DB_URL);
    db = database;
    client = pgClient;
    rawRepo = new DrizzleObservationRepo(db);
    normalizedRepo = new DrizzleNormalizedObservationRepo(db);
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(normalizedObservations);
    await db
      .delete(rawObservations)
      .where(and(eq(rawObservations.source, SOURCE), gte(rawObservations.observedAtUnixMs, 0)));
  });

  describe("persists support resistance JSONB confidence freshness and provenance without a schema migration", () => {
    it("round-trips point payload with confidence, freshness, and provenance", async () => {
      const providerId = `sr-point-${Date.now()}`;
      const providerRunId = `sr-run-${Date.now()}`;
      const observedAt = Date.now();
      const fetchedAt = observedAt + 100;
      const receivedAt = fetchedAt + 200;

      const rawHash = await rawRepo.insertOrClassify({
        source: SOURCE,
        sourceObservationKey: `${providerId}:${providerRunId}:SUPPORT:point`,
        observedAtUnixMs: observedAt,
        fetchedAtUnixMs: fetchedAt,
        payloadHash: "hash-raw-point",
        payloadCanonical: '{"test":"point"}',
        receivedAtUnixMs: receivedAt
      });

      expect(rawHash.outcome).toBe("inserted");
      const rawId = rawHash.row.id;

      const pointPayload: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        levelType: "point",
        levelUsdcPerSol: 150.5,
        evidenceSide: "SUPPORT",
        timeframe: "1h",
        thesisCodes: ["thesis-a"],
        asOfUnixMs: observedAt,
        expiresAtUnixMs: observedAt + 86400000,
        invalidationConditions: ["condition-a"],
        warnings: [],
        sourceReferences: ["ref-1"],
        sourceQuality: {
          providerId,
          reliability: 0.95,
          completeness: "complete"
        }
      };

      const confidence = {
        ...DEFAULT_CONFIDENCE,
        compositeScore: 0.9,
        level: "high" as const
      };

      const provenance = {
        ...DEFAULT_PROVENANCE,
        sourceRefs: [
          {
            refType: "raw_observation" as const,
            id: rawId,
            source: SOURCE,
            payloadHash: "hash-raw-point"
          }
        ]
      };

      const inserted = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: pointPayload,
        payloadHash: "hash-norm-point",
        confidence,
        confidenceComposite: 0.9,
        confidenceLevel: "high",
        validUntilUnixMs: observedAt + 86400000,
        isStale: false,
        staleBehavior: "allow_context_only",
        provenance,
        receivedAtUnixMs: receivedAt
      });

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.payload).toMatchObject(pointPayload);
      expect(inserted.confidence).toMatchObject(confidence);
      expect(inserted.confidenceComposite).toBe(0.9);
      expect(inserted.confidenceLevel).toBe("high");
      expect(inserted.validUntilUnixMs).toBe(observedAt + 86400000);
      expect(inserted.isStale).toBe(false);
      expect(inserted.staleBehavior).toBe("allow_context_only");
      expect(inserted.provenance).toMatchObject(provenance);
      expect(inserted.receivedAtUnixMs).toBe(receivedAt);

      const found = await normalizedRepo.findByRawObservation(rawId, "support_resistance_level");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(inserted.id);
      expect(
        (found!.payload as unknown as { levelType: string; levelUsdcPerSol: number }).levelType
      ).toBe("point");
      expect(
        (found!.payload as unknown as { levelType: string; levelUsdcPerSol: number })
          .levelUsdcPerSol
      ).toBe(150.5);
    });

    it("round-trips zone payload with isStale true and degraded confidence", async () => {
      const providerId = `sr-zone-${Date.now()}`;
      const providerRunId = `sr-run-${Date.now()}`;
      const observedAt = Date.now() - 86400000 * 3;
      const fetchedAt = observedAt + 100;
      const receivedAt = fetchedAt + 200;

      const rawHash = await rawRepo.insertOrClassify({
        source: SOURCE,
        sourceObservationKey: `${providerId}:${providerRunId}:RESISTANCE:zone`,
        observedAtUnixMs: observedAt,
        fetchedAtUnixMs: fetchedAt,
        payloadHash: "hash-raw-zone",
        payloadCanonical: '{"test":"zone"}',
        receivedAtUnixMs: receivedAt
      });

      expect(rawHash.outcome).toBe("inserted");
      const rawId = rawHash.row.id;

      const zonePayload: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        levelType: "zone",
        zoneLowerUsdcPerSol: 140.0,
        zoneUpperUsdcPerSol: 160.0,
        evidenceSide: "RESISTANCE",
        timeframe: "4h",
        thesisCodes: [],
        asOfUnixMs: observedAt,
        expiresAtUnixMs: observedAt + 86400000,
        invalidationConditions: [],
        warnings: ["stale_observation"],
        sourceReferences: [],
        sourceQuality: {
          providerId,
          reliability: 0.7,
          completeness: "partial"
        }
      };

      const degradedConfidence = {
        components: {
          sourceReliability: 0.7,
          dataCompleteness: 0.5,
          derivationConfidence: 1,
          llmConfidence: null
        },
        compositeScore: 0.35,
        level: "low" as const,
        weightingVersion: "v1",
        reasons: ["stale_input_degraded"] as const
      };

      const inserted = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: zonePayload,
        payloadHash: "hash-norm-zone",
        confidence: degradedConfidence,
        confidenceComposite: 0.35,
        confidenceLevel: "low",
        validUntilUnixMs: observedAt + 86400000,
        isStale: true,
        staleBehavior: "allow_context_only",
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: receivedAt
      });

      expect(inserted.isStale).toBe(true);
      expect(inserted.confidenceComposite).toBe(0.35);
      expect(inserted.confidenceLevel).toBe("low");
      expect(inserted.staleBehavior).toBe("allow_context_only");
      expect(
        (
          inserted.payload as unknown as {
            levelType: string;
            zoneLowerUsdcPerSol: number;
            zoneUpperUsdcPerSol: number;
          }
        ).levelType
      ).toBe("zone");
      expect(
        (
          inserted.payload as unknown as {
            levelType: string;
            zoneLowerUsdcPerSol: number;
            zoneUpperUsdcPerSol: number;
          }
        ).zoneLowerUsdcPerSol
      ).toBe(140.0);
      expect(
        (
          inserted.payload as unknown as {
            levelType: string;
            zoneLowerUsdcPerSol: number;
            zoneUpperUsdcPerSol: number;
          }
        ).zoneUpperUsdcPerSol
      ).toBe(160.0);

      const found = await normalizedRepo.findByRawObservation(rawId, "support_resistance_level");
      expect(found).not.toBeNull();
      expect(found!.isStale).toBe(true);
      expect(found!.confidenceComposite).toBe(0.35);
    });
  });

  describe("returns the existing normalized row for an identical payload hash and keeps distinct payloads independent", () => {
    it("returns existing row for identical payload hash under same raw observation", async () => {
      const providerId = `sr-dup-${Date.now()}`;
      const providerRunId = `sr-run-dup`;
      const observedAt = Date.now();
      const fetchedAt = observedAt + 100;
      const receivedAt = fetchedAt + 200;

      const rawResult = await rawRepo.insertOrClassify({
        source: SOURCE,
        sourceObservationKey: `${providerId}:${providerRunId}:SUPPORT:point`,
        observedAtUnixMs: observedAt,
        fetchedAtUnixMs: fetchedAt,
        payloadHash: "hash-raw-dup",
        payloadCanonical: '{"test":"dup"}',
        receivedAtUnixMs: receivedAt
      });

      expect(rawResult.outcome).toBe("inserted");
      const rawId = rawResult.row.id;

      const payload1: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        levelType: "point",
        levelUsdcPerSol: 100.0,
        evidenceSide: "SUPPORT",
        timeframe: "1h",
        thesisCodes: ["thesis-1"],
        asOfUnixMs: observedAt,
        expiresAtUnixMs: observedAt + 86400000,
        invalidationConditions: [],
        warnings: [],
        sourceReferences: ["ref-a"],
        sourceQuality: {
          providerId,
          reliability: 1.0,
          completeness: "complete"
        }
      };

      const first = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: payload1,
        payloadHash: "hash-identical",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: receivedAt
      });

      const second = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: payload1,
        payloadHash: "hash-identical",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: receivedAt
      });

      expect(second.id).toBe(first.id);
      expect(second.payload as object).toMatchObject(first.payload as object);
    });

    it("keeps distinct payload hashes independent even under same raw observation", async () => {
      const providerId = `sr-distinct-${Date.now()}`;
      const providerRunId = `sr-run-distinct`;
      const observedAt = Date.now();
      const fetchedAt = observedAt + 100;
      const receivedAt = fetchedAt + 200;

      const rawResult = await rawRepo.insertOrClassify({
        source: SOURCE,
        sourceObservationKey: `${providerId}:${providerRunId}:RESISTANCE:distinct`,
        observedAtUnixMs: observedAt,
        fetchedAtUnixMs: fetchedAt,
        payloadHash: "hash-raw-distinct",
        payloadCanonical: '{"test":"distinct"}',
        receivedAtUnixMs: receivedAt
      });

      expect(rawResult.outcome).toBe("inserted");
      const rawId = rawResult.row.id;

      const payloadA: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        levelType: "point",
        levelUsdcPerSol: 180.0,
        evidenceSide: "RESISTANCE",
        timeframe: "1h",
        thesisCodes: ["thesis-a"],
        asOfUnixMs: observedAt,
        expiresAtUnixMs: observedAt + 86400000,
        invalidationConditions: [],
        warnings: [],
        sourceReferences: ["ref-a"],
        sourceQuality: {
          providerId,
          reliability: 1.0,
          completeness: "complete"
        }
      };

      const payloadB: SupportResistancePayloadV1 = {
        kind: "support_resistance_level",
        schemaVersion: 1,
        pair: "SOL/USDC",
        unit: "USDC_PER_SOL",
        levelType: "point",
        levelUsdcPerSol: 200.0,
        evidenceSide: "RESISTANCE",
        timeframe: "1h",
        thesisCodes: ["thesis-b"],
        asOfUnixMs: observedAt,
        expiresAtUnixMs: observedAt + 86400000,
        invalidationConditions: [],
        warnings: [],
        sourceReferences: ["ref-b"],
        sourceQuality: {
          providerId,
          reliability: 1.0,
          completeness: "complete"
        }
      };

      const first = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: payloadA,
        payloadHash: "hash-payload-a",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: receivedAt
      });

      const second = await normalizedRepo.insert({
        rawObservationId: rawId,
        source: SOURCE,
        observationKind: "support_resistance_level",
        signalClass: "deterministic",
        evidenceFamily: "support_resistance",
        payload: payloadB,
        payloadHash: "hash-payload-b",
        confidence: DEFAULT_CONFIDENCE,
        provenance: DEFAULT_PROVENANCE,
        receivedAtUnixMs: receivedAt
      });

      expect(second.id).not.toBe(first.id);
      expect((second.payload as unknown as { levelUsdcPerSol: number }).levelUsdcPerSol).toBe(
        200.0
      );
      expect((first.payload as unknown as { levelUsdcPerSol: number }).levelUsdcPerSol).toBe(180.0);

      const rows = await normalizedRepo.findBySource(SOURCE, "support_resistance_level", 0);
      const forThisRaw = rows.filter((r) => r.rawObservationId === rawId);
      expect(forThisRaw.length).toBe(2);
    });
  });
});
