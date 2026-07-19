import { describe, it, expect } from "vitest";
import { canonicalizePayload } from "../../../src/domain/content-hash.js";
import type { PriceObservationWarning } from "../../../src/contracts/normalized-price-observation.js";
import type { Confidence, Provenance } from "../../../src/contracts/taxonomy.js";

const SOL_USD_ASSETS = {
  baseMint: "So11111111111111111111111111111111111111112",
  quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  baseDecimals: 9,
  quoteDecimals: 6
} as const;

describe("enrichPriceObservation", () => {
  describe("classifies exactly-at-limit price observations as fresh and later observations as stale", () => {
    it("Pyth: observation exactly at maxObservedAgeMs limit is fresh (publish time)", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const payloadHash = "abc123";
      const rawObservationId = 1;

      const pythPayload = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.01",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "170.51",
          lowerBound: "170.49"
        },
        confidenceRatio: "10",
        warnings: [] as readonly PriceObservationWarning[]
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs: fetchedAtUnixMs + 10,
        payload: pythPayload,
        nowMs: observedAtUnixMs + 60_000,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      expect(result.isStale).toBe(false);
      expect(result.staleBehavior).toBe("exclude");
    });

    it("Pyth: observation past maxObservedAgeMs is stale (publish time)", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const payloadHash = "abc123";
      const rawObservationId = 1;

      const pythPayload = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.01",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "170.51",
          lowerBound: "170.49"
        },
        confidenceRatio: "10",
        warnings: [] as readonly PriceObservationWarning[]
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs: fetchedAtUnixMs + 10,
        payload: pythPayload,
        nowMs: observedAtUnixMs + 60_001,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      expect(result.isStale).toBe(true);
      expect(result.staleBehavior).toBe("exclude");
    });

    it("Jupiter: observation exactly at maxObservedAgeMs limit is fresh (receipt time)", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const fetchedAtUnixMs = 1_000_000_000;
      const receivedAtUnixMs = fetchedAtUnixMs + 100;
      const observedAtUnixMs = fetchedAtUnixMs;
      const payloadHash = "def456";
      const rawObservationId = 2;

      const jupiterPayload = {
        kind: "executable_quote" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        quoteData: {
          price: "170.50",
          slippageBps: 50,
          thresholdBps: 50,
          exactProbe: "exactIn" as const,
          receivedAtUnixMs,
          fetchedAtUnixMs
        },
        observedSource: {
          source: "jupiter-quote" as const,
          observedAtUnixMs,
          slot: 100
        },
        routeSummary: {
          routeAvailable: true as const,
          hops: [
            {
              pool: "pool-1",
              inputMint: SOL_USD_ASSETS.baseMint,
              outputMint: SOL_USD_ASSETS.quoteMint,
              protocol: "jupiter"
            }
          ]
        },
        warnings: [] as readonly PriceObservationWarning[],
        priceImpactRatio: "5"
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "jupiter-quote",
        sourceObservationKey: "quote-456",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs,
        payload: jupiterPayload,
        nowMs: receivedAtUnixMs + 30_000,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      expect(result.isStale).toBe(false);
      expect(result.staleBehavior).toBe("exclude");
    });

    it("Jupiter: observation past maxObservedAgeMs is stale (receipt time)", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const fetchedAtUnixMs = 1_000_000_000;
      const receivedAtUnixMs = fetchedAtUnixMs + 100;
      const observedAtUnixMs = fetchedAtUnixMs;
      const payloadHash = "def456";
      const rawObservationId = 2;

      const jupiterPayload = {
        kind: "executable_quote" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        quoteData: {
          price: "170.50",
          slippageBps: 50,
          thresholdBps: 50,
          exactProbe: "exactIn" as const,
          receivedAtUnixMs,
          fetchedAtUnixMs
        },
        observedSource: {
          source: "jupiter-quote" as const,
          observedAtUnixMs,
          slot: 100
        },
        routeSummary: {
          routeAvailable: true as const,
          hops: [
            {
              pool: "pool-1",
              inputMint: SOL_USD_ASSETS.baseMint,
              outputMint: SOL_USD_ASSETS.quoteMint,
              protocol: "jupiter"
            }
          ]
        },
        warnings: [] as readonly PriceObservationWarning[],
        priceImpactRatio: "5"
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "jupiter-quote",
        sourceObservationKey: "quote-456",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs,
        payload: jupiterPayload,
        nowMs: receivedAtUnixMs + 30_001,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      expect(result.isStale).toBe(true);
      expect(result.staleBehavior).toBe("exclude");
    });
  });

  describe("degrades source quality without conflating provider uncertainty with completeness", () => {
    it("applies min(1, 100 / observedRatioBps) to sourceReliability when ratio > 100 bps", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const payloadHash = "abc123";
      const rawObservationId = 1;

      const pythPayload = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.50",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "171.00",
          lowerBound: "170.00"
        },
        confidenceRatio: "2941",
        warnings: ["wide_confidence_interval"] as readonly PriceObservationWarning[]
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs: fetchedAtUnixMs + 10,
        payload: pythPayload,
        nowMs: observedAtUnixMs + 30_000,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      const {
        components: { dataCompleteness, sourceReliability, derivationConfidence },
        reasons
      } = result.confidence as Confidence;
      expect(dataCompleteness).toBe(1.0);
      expect(sourceReliability).toBeLessThan(1.0);
      expect(reasons).toContain("oracle_confidence_wide");
      expect(derivationConfidence).toBe(1.0);
    });

    it("does not degrade when ratio <= 100 bps", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const payloadHash = "abc123";
      const rawObservationId = 1;

      const pythPayload = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.01",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "170.51",
          lowerBound: "170.49"
        },
        confidenceRatio: "59",
        warnings: [] as readonly PriceObservationWarning[]
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs: fetchedAtUnixMs + 10,
        payload: pythPayload,
        nowMs: observedAtUnixMs + 30_000,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      const {
        components: { sourceReliability },
        reasons
      } = result.confidence as Confidence;
      expect(sourceReliability).toBe(1.0);
      expect(reasons).not.toContain("oracle_confidence_wide");
    });

    it("Jupiter price impact above 100 bps applies degradation to sourceReliability only", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const fetchedAtUnixMs = 1_000_000_000;
      const receivedAtUnixMs = fetchedAtUnixMs + 100;
      const observedAtUnixMs = fetchedAtUnixMs;
      const payloadHash = "def456";
      const rawObservationId = 2;

      const jupiterPayload = {
        kind: "executable_quote" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        quoteData: {
          price: "170.50",
          slippageBps: 50,
          thresholdBps: 50,
          exactProbe: "exactIn" as const,
          receivedAtUnixMs,
          fetchedAtUnixMs
        },
        observedSource: {
          source: "jupiter-quote" as const,
          observedAtUnixMs,
          slot: 100
        },
        routeSummary: {
          routeAvailable: true as const,
          hops: [
            {
              pool: "pool-1",
              inputMint: SOL_USD_ASSETS.baseMint,
              outputMint: SOL_USD_ASSETS.quoteMint,
              protocol: "jupiter"
            }
          ]
        },
        warnings: ["price_impact_exceeds_threshold"] as readonly PriceObservationWarning[],
        priceImpactRatio: "200"
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "jupiter-quote",
        sourceObservationKey: "quote-456",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs,
        payload: jupiterPayload,
        nowMs: receivedAtUnixMs + 15_000,
        codeVersion: "v1.0.0",
        pipelineRunId: "run-001"
      });

      const {
        components: { dataCompleteness, sourceReliability, derivationConfidence },
        reasons
      } = result.confidence as Confidence;
      expect(dataCompleteness).toBe(1.0);
      expect(sourceReliability).toBeLessThan(1.0);
      expect(reasons).toContain("high_price_impact");
      expect(derivationConfidence).toBe(1.0);
    });
  });

  describe("builds provenance for exactly one accepted raw observation", () => {
    it("records payload hash, collector/job identity, code version, and run ID", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const receivedAtUnixMs = fetchedAtUnixMs + 10;
      const rawObservationId = 42;
      const inputPayloadHash = "hash-abc-123";
      const codeVersion = "v2.1.0";
      const pipelineRunId = "run-xyz-789";
      const collector = "price-collector";
      const jobName = "collect-oracle-price";

      const pythPayload = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.01",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "170.51",
          lowerBound: "170.49"
        },
        confidenceRatio: "59",
        warnings: [] as readonly PriceObservationWarning[]
      };

      const { payloadHash: expectedCanonicalHash } = await canonicalizePayload(pythPayload);

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash: inputPayloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs,
        payload: pythPayload,
        nowMs: observedAtUnixMs + 30_000,
        codeVersion,
        pipelineRunId,
        collector,
        jobName
      });

      const provenance = result.provenance as Provenance;
      expect(provenance.rawObservationRefs).toHaveLength(1);
      expect(provenance.rawObservationRefs[0]).toMatchObject({
        refType: "raw_observation",
        id: rawObservationId,
        source: "pyth-hermes",
        payloadHash: expectedCanonicalHash
      });

      expect(provenance.sourceRefs).toHaveLength(1);
      expect(provenance.sourceRefs[0]).toMatchObject({
        refType: "raw_observation",
        id: rawObservationId,
        source: "pyth-hermes",
        payloadHash: expectedCanonicalHash
      });

      expect(provenance.processRef).toMatchObject({
        collector,
        jobName,
        pipelineRunId,
        codeVersion,
        modelVersion: null
      });

      expect(provenance.codeVersion).toBe(codeVersion);
      expect(provenance.runId).toBe(pipelineRunId);
    });

    it("contains payload hash matching canonical hash of complete normalized payload including warnings", async () => {
      const { enrichPriceObservation } =
        await import("../../../src/domain/price-observation/enrich.js");

      const observedAtUnixMs = 1_000_000_000;
      const fetchedAtUnixMs = 1_000_000_050;
      const receivedAtUnixMs = fetchedAtUnixMs + 10;
      const rawObservationId = 42;
      const payloadHash = "hash-abc-123";
      const codeVersion = "v2.1.0";
      const pipelineRunId = "run-xyz-789";
      const collector = "price-collector";
      const jobName = "collect-oracle-price";

      const pythPayloadWithWarnings = {
        kind: "oracle_price" as const,
        schemaVersion: 1 as const,
        pair: "SOL/USDC" as const,
        assets: SOL_USD_ASSETS,
        priceData: {
          price: "170.50",
          confidence: "0.01",
          status: "trading" as const,
          ageMs: 50
        },
        observedSource: {
          source: "pyth-hermes" as const,
          observedAtUnixMs,
          fetchedAtUnixMs,
          slot: 100
        },
        bounds: {
          upperBound: "170.51",
          lowerBound: "170.49"
        },
        confidenceRatio: "59",
        warnings: ["stale_observation"] as readonly PriceObservationWarning[]
      };

      const result = await enrichPriceObservation({
        rawObservationId,
        source: "pyth-hermes",
        sourceObservationKey: "feed-123",
        payloadHash,
        observedAtUnixMs,
        fetchedAtUnixMs,
        receivedAtUnixMs,
        payload: pythPayloadWithWarnings,
        nowMs: observedAtUnixMs + 30_000,
        codeVersion,
        pipelineRunId,
        collector,
        jobName
      });

      const { payloadHash: recomputedHash } = await canonicalizePayload(pythPayloadWithWarnings);
      const provenance = result.provenance as Provenance;
      expect(provenance.rawObservationRefs[0]!.payloadHash).toBe(recomputedHash);
    });
  });
});
