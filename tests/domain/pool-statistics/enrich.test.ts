import { describe, it, expect } from "vitest";
import {
  makeOrcaPoolResponse,
  DEFAULT_WHIRLPOOL_ADDRESS,
  DEFAULT_SOL_MINT,
  DEFAULT_USDC_MINT
} from "../../fixtures/orca-pool.js";
import {
  acceptOrcaPoolResponse,
  normalizeOrcaPoolStatistics
} from "../../../src/domain/pool-statistics/index.js";
import { enrichPoolStatistics } from "../../../src/domain/pool-statistics/enrich.js";

describe("classifies exactly five minutes as fresh and later pool statistics as stale", () => {
  it("marks exactly five minutes (300,000 ms) since updatedAt as fresh", async () => {
    const response = makeOrcaPoolResponse({
      updatedAt: "2026-07-19T06:00:00.000Z"
    });
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalized = normalizeOrcaPoolStatistics({
      accepted,
      fetchedAtUnixMs: 1784502000000 // 2026-07-19T06:00:00Z is 1784502000000
    });

    const enriched = await enrichPoolStatistics({
      candidate: {
        id: 42,
        source: "orca-public-api",
        payloadHash: "hash123",
        receivedAtUnixMs: 1784502300000,
        fetchedAtUnixMs: 1784502300000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalized
      },
      nowMs: 1784502300000, // exactly 5 minutes (300,000 ms) after 1784502000000
      codeVersion: "1.0.0",
      runId: "run-123"
    });

    expect(enriched.freshness.isStale).toBe(false);
    expect(enriched.freshness.reasons).toEqual([]);
  });

  it("marks strictly greater than five minutes since updatedAt as stale", async () => {
    const response = makeOrcaPoolResponse({
      updatedAt: "2026-07-19T06:00:00.000Z"
    });
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalized = normalizeOrcaPoolStatistics({
      accepted,
      fetchedAtUnixMs: 1784502000000
    });

    const enriched = await enrichPoolStatistics({
      candidate: {
        id: 42,
        source: "orca-public-api",
        payloadHash: "hash123",
        receivedAtUnixMs: 1784502301000,
        fetchedAtUnixMs: 1784502301000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalized
      },
      nowMs: 1784502301000, // 5 minutes and 1 second after 1784502000000
      codeVersion: "1.0.0",
      runId: "run-123"
    });

    expect(enriched.freshness.isStale).toBe(true);
    expect(enriched.freshness.reasons).toContain("expired_past_max_observed_age");
    expect(enriched.confidence.reasons).toContain("stale_input_degraded");
  });
});

describe("degrades confidence for staleness provider warning and metric incompleteness independently", () => {
  it("computes confidence correctly with different components", async () => {
    // Case 1: Fresh, complete, no provider warning
    const responseNormal = makeOrcaPoolResponse({
      hasWarning: false
    });
    const { accepted: acceptedNormal } = acceptOrcaPoolResponse(
      responseNormal,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalizedNormal = normalizeOrcaPoolStatistics({
      accepted: acceptedNormal,
      fetchedAtUnixMs: 1784502000000
    });
    const enrichedNormal = await enrichPoolStatistics({
      candidate: {
        id: 42,
        source: "orca-public-api",
        payloadHash: "hash123",
        receivedAtUnixMs: 1784502000000,
        fetchedAtUnixMs: 1784502000000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalizedNormal
      },
      nowMs: 1784502000000,
      codeVersion: "1.0.0",
      runId: "run-123"
    });
    expect(enrichedNormal.confidence.components.sourceReliability).toBe(1);
    expect(enrichedNormal.confidence.components.dataCompleteness).toBe(1);

    // Case 2: Fresh, complete, but has provider warning
    const responseWarn = makeOrcaPoolResponse({
      hasWarning: true
    });
    const { accepted: acceptedWarn } = acceptOrcaPoolResponse(
      responseWarn,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalizedWarn = normalizeOrcaPoolStatistics({
      accepted: acceptedWarn,
      fetchedAtUnixMs: 1784502000000
    });
    const enrichedWarn = await enrichPoolStatistics({
      candidate: {
        id: 42,
        source: "orca-public-api",
        payloadHash: "hash123",
        receivedAtUnixMs: 1784502000000,
        fetchedAtUnixMs: 1784502000000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalizedWarn
      },
      nowMs: 1784502000000,
      codeVersion: "1.0.0",
      runId: "run-123"
    });
    expect(enrichedWarn.confidence.components.sourceReliability).toBe(0.75);
    expect(enrichedWarn.confidence.components.dataCompleteness).toBe(1);

    // Case 3: Fresh, incomplete (only 1 of 3 metrics present), no provider warning
    const responseIncomplete = makeOrcaPoolResponse({
      tvlUsdc: "123.45",
      stats: null // missing volume and fees
    });
    const { accepted: acceptedIncomplete } = acceptOrcaPoolResponse(
      responseIncomplete,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalizedIncomplete = normalizeOrcaPoolStatistics({
      accepted: acceptedIncomplete,
      fetchedAtUnixMs: 1784502000000
    });
    const enrichedIncomplete = await enrichPoolStatistics({
      candidate: {
        id: 42,
        source: "orca-public-api",
        payloadHash: "hash123",
        receivedAtUnixMs: 1784502000000,
        fetchedAtUnixMs: 1784502000000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalizedIncomplete
      },
      nowMs: 1784502000000,
      codeVersion: "1.0.0",
      runId: "run-123"
    });
    expect(enrichedIncomplete.confidence.components.sourceReliability).toBe(1);
    expect(enrichedIncomplete.confidence.components.dataCompleteness).toBe(1 / 3);
  });
});

describe("raw lineage and run correlation", () => {
  it("builds one raw observation provenance reference with the collection run id", async () => {
    const response = makeOrcaPoolResponse();
    const { accepted } = acceptOrcaPoolResponse(
      response,
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    );
    const normalized = normalizeOrcaPoolStatistics({
      accepted,
      fetchedAtUnixMs: 1784502000000
    });

    const enriched = await enrichPoolStatistics({
      candidate: {
        id: 99,
        source: "orca-public-api",
        payloadHash: "hash99",
        receivedAtUnixMs: 1784502000000,
        fetchedAtUnixMs: 1784502000000,
        observedAtUnixMs: 1784502000000,
        kind: "pool_statistics",
        payload: normalized
      },
      nowMs: 1784502000000,
      codeVersion: "1.0.0",
      runId: "run-999"
    });

    expect(enriched.provenance.sourceRefs).toHaveLength(1);
    expect(enriched.provenance.sourceRefs[0]!.refType).toBe("raw_observation");
    expect(enriched.provenance.sourceRefs[0]!.id).toBe(99);
    expect(enriched.provenance.runId).toBe("run-999");
  });
});
