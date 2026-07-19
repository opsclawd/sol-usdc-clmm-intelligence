/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type { Source, ParseStatus } from "../../src/contracts/taxonomy.js";
import type {
  RawObservationRepo,
  RawInsertOutcome,
  RawObservationRow
} from "../../src/ports/observation-repo.js";
import type {
  NormalizedObservationRepo,
  NormalizedObservationInsert
} from "../../src/ports/normalized-observation-repo.js";
import type { JsonStore } from "../../src/ports/json-store.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { FakeJsonStore } from "../fakes/fake-json-store.js";
import { canonicalHash } from "../../src/domain/content-hash.js";

export class RawObservationConflictError extends Error {
  constructor(
    public readonly source: Source,
    public readonly sourceObservationKey: string,
    public readonly existingPayloadHash: string,
    public readonly incomingPayloadHash: string
  ) {
    super(
      `Conflict for ${source}:${sourceObservationKey}: existing hash ${existingPayloadHash} vs incoming ${incomingPayloadHash}`
    );
    this.name = "RawObservationConflictError";
  }
}

interface TestCandidate {
  id: number;
  kind: string;
  payload: unknown;
}

interface TestNormalized {
  observationKind: string;
  signalClass: "deterministic" | "probabilistic" | "contextual";
  evidenceFamily: "clmm_state" | "price_quality";
  payloadHash: string;
  confidence: { compositeScore: number; level: string };
  freshness: { isStale: boolean; validUntilUnixMs: number };
}

interface IngestRawObservationInput {
  source: Source;
  sourceObservationKey: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadCanonical: string;
  payloadHash: string;
  sourceRequestMeta?: unknown;
  receivedAtUnixMs: number;
  validatePayload: (canonical: string) => { accepted: unknown };
  buildCandidates: (accepted: unknown, rawRow: RawObservationRow) => TestCandidate[];
  enrichCandidates: (
    candidates: TestCandidate[],
    rawRow: RawObservationRow
  ) => Promise<TestNormalized[]>;
  insertNormalized: (normals: TestNormalized[], rawRow: RawObservationRow) => Promise<number>;
  writeCompatibilityOutput?: (accepted: unknown, rawRow: RawObservationRow) => Promise<void>;
  revalidateStoredCanonical?: (canonical: string) => { accepted: unknown };
}

async function ingestRawObservation(
  deps: {
    rawObservationRepo: RawObservationRepo;
    normalizedObservationRepo: NormalizedObservationRepo;
    jsonStore: JsonStore;
  },
  input: IngestRawObservationInput
): Promise<{
  rawObservationId: number;
  rawOutcome: RawInsertOutcome;
  normalizedCount: number;
  parseStatus: ParseStatus;
}> {
  const { rawObservationRepo } = deps;
  const {
    source,
    sourceObservationKey,
    observedAtUnixMs,
    fetchedAtUnixMs,
    payloadCanonical,
    payloadHash,
    sourceRequestMeta,
    receivedAtUnixMs,
    validatePayload,
    buildCandidates,
    enrichCandidates,
    insertNormalized,
    writeCompatibilityOutput,
    revalidateStoredCanonical
  } = input;

  const rawInsertResult = await rawObservationRepo.insertOrClassify({
    source,
    sourceObservationKey,
    observedAtUnixMs,
    fetchedAtUnixMs,
    payloadHash,
    payloadCanonical,
    parseStatus: "pending",
    sourceRequestMeta,
    receivedAtUnixMs
  });

  if (rawInsertResult.outcome === "conflict") {
    throw new RawObservationConflictError(
      source,
      sourceObservationKey,
      rawInsertResult.row.payloadHash,
      rawInsertResult.incomingPayloadHash
    );
  }

  if (rawInsertResult.outcome === "identical_replay") {
    const existingRow = rawInsertResult.row;

    if (existingRow.parseStatus === "parsed") {
      const { accepted } = validatePayload(existingRow.payloadCanonical);
      if (writeCompatibilityOutput) {
        await writeCompatibilityOutput(accepted, existingRow);
      }
      return {
        rawObservationId: existingRow.id,
        rawOutcome: rawInsertResult,
        normalizedCount: 0,
        parseStatus: "parsed"
      };
    }

    const revalidator = revalidateStoredCanonical ?? validatePayload;
    const { accepted } = revalidator(existingRow.payloadCanonical);
    const candidates = buildCandidates(accepted, existingRow);

    const normalized = await enrichCandidates(candidates, existingRow);
    const normalizedCount = await insertNormalized(normalized, existingRow);

    const parseStatus: ParseStatus = "parsed";
    await rawObservationRepo.updateParseStatus(existingRow.id, parseStatus);

    if (writeCompatibilityOutput) {
      await writeCompatibilityOutput(accepted, existingRow);
    }

    return {
      rawObservationId: existingRow.id,
      rawOutcome: rawInsertResult,
      normalizedCount,
      parseStatus
    };
  }

  const rawRow = rawInsertResult.row;
  const { accepted } = validatePayload(payloadCanonical);
  const candidates = buildCandidates(accepted, rawRow);

  let parseStatus: ParseStatus = "pending";
  let normalizedCount = 0;

  try {
    const normalized = await enrichCandidates(candidates, rawRow);
    normalizedCount = await insertNormalized(normalized, rawRow);
    parseStatus = "parsed";
  } catch (err) {
    try {
      await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
    } catch {
      throw err;
    }
    throw err;
  }

  await rawObservationRepo.updateParseStatus(rawRow.id, parseStatus);

  if (writeCompatibilityOutput) {
    await writeCompatibilityOutput(accepted, rawRow);
  }

  return {
    rawObservationId: rawRow.id,
    rawOutcome: rawInsertResult,
    normalizedCount,
    parseStatus
  };
}

const TEST_SOURCE: Source = "pyth-hermes";

async function makeCanonicalWithHash(
  payload: unknown
): Promise<{ payloadCanonical: string; payloadHash: string }> {
  const canonical = JSON.stringify(payload);
  const hash = await canonicalHash(JSON.parse(canonical));
  return { payloadCanonical: canonical, payloadHash: hash };
}

describe("ingestRawObservation", () => {
  describe("persists raw before normalized and parsed before compatibility output", () => {
    it("enforces durable ordering", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      const events: string[] = [];
      const originalInsertOrClassify = rawRepo.insertOrClassify.bind(rawRepo);
      rawRepo.insertOrClassify = async (row) => {
        events.push("raw_insert");
        return originalInsertOrClassify(row);
      };

      const originalInsertMany = normRepo.insertMany.bind(normRepo);
      normRepo.insertMany = async (rows) => {
        events.push("normalized_batch");
        return originalInsertMany(rows);
      };

      const originalUpdateParseStatus = rawRepo.updateParseStatus.bind(rawRepo);
      rawRepo.updateParseStatus = async (id, status) => {
        events.push(`parse_status_${status}`);
        return originalUpdateParseStatus(id, status);
      };

      const originalWriteJson = jsonStore.writeJson.bind(jsonStore);
      jsonStore.writeJson = async (path, data) => {
        return originalWriteJson(path, data);
      };

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-order",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async (accepted) => {
            events.push(`compatibility_output`);
            await originalWriteJson("data/compatibility.json", accepted);
          }
        }
      );

      expect(events).toEqual([
        "raw_insert",
        "normalized_batch",
        "parse_status_parsed",
        "compatibility_output"
      ]);
    });
  });

  describe("reuses a parsed identical replay without duplicate normalization", () => {
    it("skips normalization for parsed replay and writes no new normalized rows", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      let normalizeCount = 0;

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-reuse",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => {
            normalizeCount++;
            return [{ id: 1, kind: "oracle_price", payload: accepted }];
          },
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      const countAfterFirst = normRepo.count;

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-reuse",
          observedAtUnixMs: 2000,
          fetchedAtUnixMs: 2001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 2002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => {
            normalizeCount++;
            return [{ id: 1, kind: "oracle_price", payload: accepted }];
          },
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      expect(normalizeCount).toBe(1);
      expect(normRepo.count).toBe(countAfterFirst);
    });
  });

  describe("recovers pending or failed identical replays from stored canonical payload", () => {
    it("normalizes from payloadCanonical when parseStatus is pending", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-recover",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      const rawRows = [...rawRepo["store"].values()];
      await rawRepo.updateParseStatus(rawRows[0]!.id, "pending");

      const normalizedCountBefore = normRepo.count;

      const result2 = await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-recover",
          observedAtUnixMs: 2000,
          fetchedAtUnixMs: 2001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 2002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      expect(result2.parseStatus).toBe("parsed");
      expect(normRepo.count).toBe(normalizedCountBefore);

      const updatedRawRows = [...rawRepo["store"].values()];
      expect(updatedRawRows[0]!.parseStatus).toBe("parsed");
    });

    it("normalizes from payloadCanonical when parseStatus is failed", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-recover-failed",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      const rawRows = [...rawRepo["store"].values()];
      await rawRepo.updateParseStatus(rawRows[0]!.id, "failed");

      const normalizedCountBefore = normRepo.count;

      const result2 = await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-recover-failed",
          observedAtUnixMs: 2000,
          fetchedAtUnixMs: 2001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 2002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      expect(result2.parseStatus).toBe("parsed");
      expect(normRepo.count).toBe(normalizedCountBefore);

      const updatedRawRows = [...rawRepo["store"].values()];
      expect(updatedRawRows[0]!.parseStatus).toBe("parsed");
    });
  });

  describe("rejects conflicting replay without overwriting the existing row", () => {
    it("throws conflict error and leaves existing row untouched", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const payload1 = { price: 150.5, symbol: "SOL" };
      const payload2 = { price: 999.9, symbol: "SOL" };

      const canonical1 = JSON.stringify(payload1);
      const hash1 = await canonicalHash(payload1);
      const canonical2 = JSON.stringify(payload2);
      const hash2 = await canonicalHash(payload2);

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-conflict",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical: canonical1,
          payloadHash: hash1,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      await expect(
        ingestRawObservation(
          { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
          {
            source: TEST_SOURCE,
            sourceObservationKey: "test-key-conflict",
            observedAtUnixMs: 2000,
            fetchedAtUnixMs: 2001,
            payloadCanonical: canonical2,
            payloadHash: hash2,
            receivedAtUnixMs: 2002,
            validatePayload: (c) => ({ accepted: JSON.parse(c) }),
            buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
            enrichCandidates: async (candidates) =>
              candidates.map((c) => ({
                observationKind: c.kind,
                signalClass: "deterministic" as const,
                evidenceFamily: "clmm_state" as const,
                payloadHash: "hash",
                confidence: { compositeScore: 0.9, level: "high" },
                freshness: { isStale: false, validUntilUnixMs: 2000 }
              })),
            insertNormalized: async (normals) => {
              const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
                rawObservationId: 1,
                source: TEST_SOURCE,
                observationKind: n.observationKind as any,
                signalClass: n.signalClass,
                evidenceFamily: n.evidenceFamily,
                payload: {},
                payloadHash: n.payloadHash,
                confidence: n.confidence as any,
                confidenceComposite: n.confidence.compositeScore,
                confidenceLevel: n.confidence.level,
                validUntilUnixMs: n.freshness.validUntilUnixMs,
                isStale: n.freshness.isStale,
                provenance: {},
                receivedAtUnixMs: 1002
              }));
              const results = await normRepo.insertMany(inserts);
              return results.length;
            },
            writeCompatibilityOutput: async () => {}
          }
        )
      ).rejects.toThrow(RawObservationConflictError);

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.payloadHash).toBe(hash1);
    });
  });

  describe("marks raw failed when normalization fails and converges after a status-update failure", () => {
    it("marks raw as failed when normalization fails", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      normRepo.failAtIndex = 0;

      await expect(
        ingestRawObservation(
          { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
          {
            source: TEST_SOURCE,
            sourceObservationKey: "test-key-fail",
            observedAtUnixMs: 1000,
            fetchedAtUnixMs: 1001,
            payloadCanonical,
            payloadHash,
            receivedAtUnixMs: 1002,
            validatePayload: (c) => ({ accepted: JSON.parse(c) }),
            buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
            enrichCandidates: async (candidates) =>
              candidates.map((c) => ({
                observationKind: c.kind,
                signalClass: "deterministic" as const,
                evidenceFamily: "clmm_state" as const,
                payloadHash: "hash",
                confidence: { compositeScore: 0.9, level: "high" },
                freshness: { isStale: false, validUntilUnixMs: 2000 }
              })),
            insertNormalized: async (normals) => {
              const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
                rawObservationId: 1,
                source: TEST_SOURCE,
                observationKind: n.observationKind as any,
                signalClass: n.signalClass,
                evidenceFamily: n.evidenceFamily,
                payload: {},
                payloadHash: n.payloadHash,
                confidence: n.confidence as any,
                confidenceComposite: n.confidence.compositeScore,
                confidenceLevel: n.confidence.level,
                validUntilUnixMs: n.freshness.validUntilUnixMs,
                isStale: n.freshness.isStale,
                provenance: {},
                receivedAtUnixMs: 1002
              }));
              const results = await normRepo.insertMany(inserts);
              return results.length;
            },
            writeCompatibilityOutput: async () => {}
          }
        )
      ).rejects.toThrow();

      const rawRows = [...rawRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("failed");
    });

    it("converges after a status-update failure", async () => {
      const rawRepo = new FakeObservationRepo();
      const normRepo = new FakeNormalizedObservationRepo();
      const jsonStore = new FakeJsonStore();

      const canonicalPayload = { price: 150.5, symbol: "SOL" };
      const { payloadCanonical, payloadHash } = await makeCanonicalWithHash(canonicalPayload);

      await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-status-fail",
          observedAtUnixMs: 1000,
          fetchedAtUnixMs: 1001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 1002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      const rawRows = [...rawRepo["store"].values()];
      await rawRepo.updateParseStatus(rawRows[0]!.id, "pending");

      const normalizedCountAfterFirst = normRepo.count;

      rawRepo.failOnUpdateParseStatus = new Error("status update failed");

      await expect(
        ingestRawObservation(
          { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
          {
            source: TEST_SOURCE,
            sourceObservationKey: "test-key-status-fail",
            observedAtUnixMs: 2000,
            fetchedAtUnixMs: 2001,
            payloadCanonical,
            payloadHash,
            receivedAtUnixMs: 2002,
            validatePayload: (c) => ({ accepted: JSON.parse(c) }),
            buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
            enrichCandidates: async (candidates) =>
              candidates.map((c) => ({
                observationKind: c.kind,
                signalClass: "deterministic" as const,
                evidenceFamily: "clmm_state" as const,
                payloadHash: "hash",
                confidence: { compositeScore: 0.9, level: "high" },
                freshness: { isStale: false, validUntilUnixMs: 2000 }
              })),
            insertNormalized: async (normals) => {
              const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
                rawObservationId: 1,
                source: TEST_SOURCE,
                observationKind: n.observationKind as any,
                signalClass: n.signalClass,
                evidenceFamily: n.evidenceFamily,
                payload: {},
                payloadHash: n.payloadHash,
                confidence: n.confidence as any,
                confidenceComposite: n.confidence.compositeScore,
                confidenceLevel: n.confidence.level,
                validUntilUnixMs: n.freshness.validUntilUnixMs,
                isStale: n.freshness.isStale,
                provenance: {},
                receivedAtUnixMs: 1002
              }));
              const results = await normRepo.insertMany(inserts);
              return results.length;
            },
            writeCompatibilityOutput: async () => {}
          }
        )
      ).rejects.toThrow("status update failed");

      const rawRowsAfterFailure = [...rawRepo["store"].values()];
      expect(rawRowsAfterFailure[0]!.parseStatus).toBe("pending");
      expect(normRepo.count).toBe(normalizedCountAfterFirst);

      rawRepo.failOnUpdateParseStatus = null;

      const result3 = await ingestRawObservation(
        { rawObservationRepo: rawRepo, normalizedObservationRepo: normRepo, jsonStore },
        {
          source: TEST_SOURCE,
          sourceObservationKey: "test-key-status-fail",
          observedAtUnixMs: 3000,
          fetchedAtUnixMs: 3001,
          payloadCanonical,
          payloadHash,
          receivedAtUnixMs: 3002,
          validatePayload: (c) => ({ accepted: JSON.parse(c) }),
          buildCandidates: (accepted) => [{ id: 1, kind: "oracle_price", payload: accepted }],
          enrichCandidates: async (candidates) =>
            candidates.map((c) => ({
              observationKind: c.kind,
              signalClass: "deterministic" as const,
              evidenceFamily: "clmm_state" as const,
              payloadHash: "hash",
              confidence: { compositeScore: 0.9, level: "high" },
              freshness: { isStale: false, validUntilUnixMs: 2000 }
            })),
          insertNormalized: async (normals) => {
            const inserts: NormalizedObservationInsert[] = normals.map((n) => ({
              rawObservationId: 1,
              source: TEST_SOURCE,
              observationKind: n.observationKind as any,
              signalClass: n.signalClass,
              evidenceFamily: n.evidenceFamily,
              payload: {},
              payloadHash: n.payloadHash,
              confidence: n.confidence as any,
              confidenceComposite: n.confidence.compositeScore,
              confidenceLevel: n.confidence.level,
              validUntilUnixMs: n.freshness.validUntilUnixMs,
              isStale: n.freshness.isStale,
              provenance: {},
              receivedAtUnixMs: 1002
            }));
            const results = await normRepo.insertMany(inserts);
            return results.length;
          },
          writeCompatibilityOutput: async () => {}
        }
      );

      expect(result3.parseStatus).toBe("parsed");
      expect(normRepo.count).toBe(normalizedCountAfterFirst);
    });
  });
});
