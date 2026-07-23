import { describe, expect, it } from "vitest";
import type {
  SupportResistanceSourceSnapshot,
  SupportResistanceSourceError
} from "../../src/ports/support-resistance-source.js";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import { FakeSupportResistanceSource } from "../fakes/fake-support-resistance-source.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectSupportResistance } from "../../src/application/collect-support-resistance.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-sr-123",
  startedAtUnixMs: 1704067200000
});

const VALID_SNAPSHOT: SupportResistanceSourceSnapshot = {
  providerId: "provider-test-001",
  providerRunId: "run-test-001",
  pair: "SOL/USDC",
  asOfUnixMs: 1704067200000,
  claims: [
    {
      levelType: "point",
      levelUsdcPerSol: 150.5,
      evidenceSide: "SUPPORT",
      timeframe: "1h",
      sourceReferences: ["ref1", "ref2"]
    },
    {
      levelType: "point",
      levelUsdcPerSol: 175.0,
      evidenceSide: "RESISTANCE",
      timeframe: "1h",
      sourceReferences: ["ref1"]
    }
  ]
};

function makeDeps() {
  return {
    supportResistanceSource: new FakeSupportResistanceSource(),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

describe("collectSupportResistance", () => {
  describe("persists bounded raw material before normalized claims and marks the raw row parsed", () => {
    it("enforces durable boundary", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      const events: string[] = [];
      const originalInsertOrClassify = rawObservationRepo.insertOrClassify.bind(rawObservationRepo);
      rawObservationRepo.insertOrClassify = async (row) => {
        events.push("raw_insert");
        return originalInsertOrClassify(row);
      };
      const originalInsertMany =
        normalizedObservationRepo.insertMany.bind(normalizedObservationRepo);
      normalizedObservationRepo.insertMany = async (rows) => {
        events.push("normalized_batch");
        return originalInsertMany(rows);
      };
      const originalUpdateParseStatus =
        rawObservationRepo.updateParseStatus.bind(rawObservationRepo);
      rawObservationRepo.updateParseStatus = async (id, status) => {
        events.push(`parse_status_${status}`);
        return originalUpdateParseStatus(id, status);
      };

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(events).toContain("raw_insert");
      expect(events.indexOf("raw_insert")).toBeLessThan(events.indexOf("normalized_batch"));
      expect(events).toContain("parse_status_parsed");
      expect(events.indexOf("normalized_batch")).toBeLessThan(
        events.indexOf("parse_status_parsed")
      );
    });
  });

  describe("returns unavailable without persistence when the source cannot be collected", () => {
    it("does not insert raw or normalized rows", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const error: SupportResistanceSourceError = {
        kind: "unavailable",
        diagnostic: "Service unavailable"
      };
      supportResistanceSource.setError(error);

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("unavailable");
      expect(result.hasUsableEvidence).toBe(false);
      expect(result.rawId).toBeNull();
      expect(rawObservationRepo["store"].size).toBe(0);
      expect(normalizedObservationRepo.count).toBe(0);
    });
  });

  describe("returns malformed without persistence when the bounded source payload is invalid", () => {
    it("does not insert raw or normalized rows", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const error: SupportResistanceSourceError = {
        kind: "malformed",
        diagnostic: "Invalid payload structure"
      };
      supportResistanceSource.setError(error);

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("malformed");
      expect(result.hasUsableEvidence).toBe(false);
      expect(result.rawId).toBeNull();
      expect(rawObservationRepo["store"].size).toBe(0);
      expect(normalizedObservationRepo.count).toBe(0);
    });
  });

  describe("retains a missing-level claim as raw degraded evidence without fabricating a normalized level", () => {
    it("persists raw but does not create normalized rows for missing levels", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshotWithMissingLevel: SupportResistanceSourceSnapshot = {
        providerId: "provider-test-001",
        providerRunId: "run-test-001",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: []
          } as SupportResistanceSourceSnapshot["claims"][number]
        ]
      };
      supportResistanceSource.setResponse(snapshotWithMissingLevel);

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("degraded");
      expect(result.hasUsableEvidence).toBe(true);
      expect(result.rawId).not.toBeNull();
      expect(result.rawCount).toBe(1);
      expect(normalizedObservationRepo.count).toBe(0);
      const rawRow = await rawObservationRepo.findById(Number(result.rawId));
      expect(rawRow?.parseStatus).toBe("parsed");
    });
  });

  describe("marks the raw row failed when normalization persistence fails", () => {
    it("transitions raw to failed and rethrows", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);
      normalizedObservationRepo.failAtIndex = 0;

      await expect(
        collectSupportResistance(
          { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
          VALID_CONTEXT
        )
      ).rejects.toThrow();

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("failed");
    });
  });

  describe("collapses an identical parsed replay without duplicate normalized rows", () => {
    it("does not insert new normalized rows on replay", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );
      const countAfterFirst = normalizedObservationRepo.count;

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(normalizedObservationRepo.count).toBe(countAfterFirst);
      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );
      expect(result.status).toBe("identical_replay");
    });
  });

  describe("recovers an identical pending or failed replay and transitions it to parsed", () => {
    it("normalizes from stored canonical when parseStatus is pending", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows[0]!.parseStatus).toBe("parsed");

      await rawObservationRepo.updateParseStatus(rawRows[0]!.id, "pending");
      normalizedObservationRepo.failAtIndex = null;

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("accepted");
      const updatedRawRows = [...rawObservationRepo["store"].values()];
      expect(updatedRawRows[0]!.parseStatus).toBe("parsed");
    });

    it("normalizes from stored canonical when parseStatus is failed", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows[0]!.parseStatus).toBe("parsed");

      await rawObservationRepo.updateParseStatus(rawRows[0]!.id, "failed");
      normalizedObservationRepo.failAtIndex = null;

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("accepted");
      const updatedRawRows = [...rawObservationRepo["store"].values()];
      expect(updatedRawRows[0]!.parseStatus).toBe("parsed");
    });
  });

  describe("rejects a conflicting replay without overwriting history", () => {
    it("throws conflict without modifying stored evidence", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const modifiedSnapshot: SupportResistanceSourceSnapshot = {
        ...VALID_SNAPSHOT,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 999.0,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(modifiedSnapshot);

      await expect(
        collectSupportResistance(
          { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
          VALID_CONTEXT
        )
      ).rejects.toThrow();

      const rawRows = [...rawObservationRepo["store"].values()];
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!.parseStatus).toBe("parsed");
    });
  });

  describe("groups equivalent same-provider-run claims and records a duplicate warning", () => {
    it("deduplicates identical claims within same provider run", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshotWithDuplicates: SupportResistanceSourceSnapshot = {
        providerId: "provider-test-001",
        providerRunId: "run-test-001",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.5,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          },
          {
            levelType: "point",
            levelUsdcPerSol: 150.5,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref2"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshotWithDuplicates);

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("degraded");
      expect(result.warnings).toContain("duplicate_equivalent_claim");
      expect(normalizedObservationRepo.count).toBe(1);
    });
  });

  describe("preserves different providers runs sides timeframes and theses independently", () => {
    it("creates distinct normalized rows for different providers", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshot1: SupportResistanceSourceSnapshot = {
        providerId: "provider-A",
        providerRunId: "run-A",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.0,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshot1);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const snapshot2: SupportResistanceSourceSnapshot = {
        providerId: "provider-B",
        providerRunId: "run-B",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.0,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshot2);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(rawObservationRepo["store"].size).toBe(2);
      expect(normalizedObservationRepo.count).toBe(2);
    });

    it("creates distinct normalized rows for different sides", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const snapshot1: SupportResistanceSourceSnapshot = {
        providerId: "provider-A",
        providerRunId: "run-A",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.0,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshot1);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const snapshot2: SupportResistanceSourceSnapshot = {
        providerId: "provider-A",
        providerRunId: "run-A",
        pair: "SOL/USDC",
        asOfUnixMs: 1704067200000,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.0,
            evidenceSide: "RESISTANCE",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshot2);

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(rawObservationRepo["store"].size).toBe(2);
      expect(normalizedObservationRepo.count).toBe(2);
    });
  });

  describe("persists expired evidence as stale context-only evidence with degraded confidence", () => {
    it("marks expired claims as stale with allow_context_only behavior", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      const expiredTimestamp = VALID_CONTEXT.startedAtUnixMs - 86400000 * 2;
      const snapshotWithExpiredClaim: SupportResistanceSourceSnapshot = {
        providerId: "provider-test-001",
        providerRunId: "run-test-001",
        pair: "SOL/USDC",
        asOfUnixMs: expiredTimestamp,
        claims: [
          {
            levelType: "point",
            levelUsdcPerSol: 150.5,
            evidenceSide: "SUPPORT",
            timeframe: "1h",
            sourceReferences: ["ref1"]
          }
        ]
      };
      supportResistanceSource.setResponse(snapshotWithExpiredClaim);

      const result = await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      expect(result.status).toBe("stale");
      expect(result.freshness.isStale).toBe(true);
      expect(result.confidence.level).toBe("low");

      const normalizedRows = await normalizedObservationRepo.findBySource(
        "technical-analysis-api",
        "support_resistance_level",
        0
      );
      expect(normalizedRows.length).toBe(1);
      expect(normalizedRows[0]!.isStale).toBe(true);
    });
  });

  describe("request metadata contains only bounded snapshot and provider identity", () => {
    it("never includes API key, bearer header, or arbitrary provider response fields", async () => {
      const { supportResistanceSource, rawObservationRepo, normalizedObservationRepo } = makeDeps();
      supportResistanceSource.setResponse(VALID_SNAPSHOT);

      let capturedMeta: unknown = null;
      const originalInsertOrClassify = rawObservationRepo.insertOrClassify.bind(rawObservationRepo);
      rawObservationRepo.insertOrClassify = async (row) => {
        capturedMeta = row.sourceRequestMeta;
        return originalInsertOrClassify(row);
      };

      await collectSupportResistance(
        { supportResistanceSource, rawObservationRepo, normalizedObservationRepo },
        VALID_CONTEXT
      );

      const meta = capturedMeta as Record<string, unknown>;
      expect(meta).toHaveProperty("providerId");
      expect(meta).toHaveProperty("providerRunId");
      expect(meta).toHaveProperty("pair");
      expect(meta).toHaveProperty("intelligenceCodeVersion");
      expect(meta).toHaveProperty("intelligencePipelineRunId");
      expect(meta).not.toHaveProperty("apiKey");
      expect(meta).not.toHaveProperty("bearer");
      expect(meta).not.toHaveProperty("headers");
    });
  });
});
