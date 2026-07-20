import { describe, expect, it } from "vitest";
import { HttpRequestError } from "../../src/ports/http.js";
import {
  makeOrcaPoolResponse,
  DEFAULT_WHIRLPOOL_ADDRESS,
  DEFAULT_SOL_MINT,
  DEFAULT_USDC_MINT
} from "../fixtures/orca-pool.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectOrcaPoolStatistics } from "../../src/application/collect-orca-pool-statistics.js";
import { canonicalizePayload } from "../../src/domain/content-hash.js";
import { deriveOrcaSourceObservationKey } from "../../src/domain/pool-statistics/identity.js";

const ORCA_API_BASE = "https://api.orca.so/v2/solana";

function createDeps() {
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      ORCA_API_BASE,
      WHIRLPOOL_ADDRESS: DEFAULT_WHIRLPOOL_ADDRESS,
      SOL_MINT: DEFAULT_SOL_MINT,
      USDC_MINT: DEFAULT_USDC_MINT
    }),
    clock: new FakeClock("2026-07-19T06:00:00.000Z"),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

const VALID_CONTEXT = Object.freeze({
  runId: "run-123",
  startedAtUnixMs: new Date("2026-07-19T06:00:00.000Z").getTime()
});

describe("collectOrcaPoolStatistics behavioral invariants", () => {
  it("persists accepted Orca raw content before normalized pool statistics and parsed status", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("accepted");
    expect(result.hasUsableEvidence).toBe(true);
    expect(result.rawObservationId).not.toBeNull();
    expect(result.normalizedCount).toBe(1);

    // Verify raw observation row was saved and set to parsed
    const rawRow = await deps.rawObservationRepo.findById(result.rawObservationId!);
    expect(rawRow).toBeDefined();
    expect(rawRow!.parseStatus).toBe("parsed");
    expect(rawRow!.sourceRequestMeta).toEqual(
      expect.objectContaining({
        method: "GET",
        host: "api.orca.so",
        path: "/public/pool",
        poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
        statsWindow: "24h",
        apiVersion: "v2",
        intelligenceCodeVersion: "development",
        intelligencePipelineRunId: "run-123"
      })
    );

    // Ensure NO json store writes were made
    expect(deps.jsonStore.writes).toHaveLength(0);

    // Verify normalized observation was written
    const normRow = await deps.normalizedObservationRepo.findByRawObservation(
      result.rawObservationId!,
      "pool_statistics"
    );
    expect(normRow).not.toBeNull();
    expect(normRow!.observationKind).toBe("pool_statistics");
    expect(normRow!.confidence.level).toBe("high");
  });

  it("rejects malformed Orca responses before raw insertion", async () => {
    const deps = createDeps();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: { data: { address: "wrong" } } }); // mismatch pool address

    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("malformed");
    expect(result.hasUsableEvidence).toBe(false);
    expect(result.rawObservationId).toBeNull();
    expect(result.normalizedCount).toBe(0);

    const rawRows = await deps.rawObservationRepo.findBySource("orca-public-api", 0);
    expect(rawRows).toHaveLength(0);
  });

  it("returns degraded usable evidence when at least one metric is present", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse({
      tvlUsdc: "1000.00",
      stats: null // volume & fees missing
    });
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("degraded");
    expect(result.hasUsableEvidence).toBe(true);

    const normRow = await deps.normalizedObservationRepo.findByRawObservation(
      result.rawObservationId!,
      "pool_statistics"
    );
    expect(normRow).not.toBeNull();
    expect(normRow!.payload).toEqual(
      expect.objectContaining({
        tvlUsdc: "1000.00",
        volume24hUsdc: null,
        fees24hUsdc: null
      })
    );
  });

  it("returns degraded non usable evidence when every metric is unavailable", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse({
      tvlUsdc: null,
      stats: null
    });
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("degraded");
    expect(result.hasUsableEvidence).toBe(false);
  });

  it("recovers parsed Orca replay metadata from its linked normalized row", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    // First collect
    const firstResult = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(firstResult.status).toBe("accepted");

    // Second collect with identical replay
    const secondResult = await collectOrcaPoolStatistics(deps, {
      ...VALID_CONTEXT,
      startedAtUnixMs: VALID_CONTEXT.startedAtUnixMs + 1000
    });
    expect(secondResult.status).toBe("identical_replay");
    expect(secondResult.hasUsableEvidence).toBe(true);
    expect(secondResult.rawObservationId).toBe(firstResult.rawObservationId);
    expect(secondResult.confidenceLevel).toBe("high");
  });

  it("recovers pending and failed Orca replays from stored canonical content", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    const { payloadCanonical, payloadHash } = await canonicalizePayload(response);
    const sourceObservationKey = await deriveOrcaSourceObservationKey({
      poolAddress: DEFAULT_WHIRLPOOL_ADDRESS,
      updatedAt: response.data.updatedAt,
      updatedSlot: response.data.updatedSlot
    });

    // Seed raw repo with a pending row
    const rawInsertRes = await deps.rawObservationRepo.insertOrClassify({
      source: "orca-public-api",
      sourceObservationKey,
      observedAtUnixMs: Date.parse(response.data.updatedAt),
      fetchedAtUnixMs: VALID_CONTEXT.startedAtUnixMs,
      payloadHash,
      payloadCanonical,
      parseStatus: "pending",
      receivedAtUnixMs: VALID_CONTEXT.startedAtUnixMs
    });
    expect(rawInsertRes.outcome).toBe("inserted");

    // Collecting now will replay the pending row
    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("identical_replay");
    expect(result.rawObservationId).toBe(rawInsertRes.row.id);
    expect(result.normalizedCount).toBe(1);

    const updatedRaw = await deps.rawObservationRepo.findById(rawInsertRes.row.id);
    expect(updatedRaw?.parseStatus).toBe("parsed");
  });

  it("rejects conflicting Orca replay without overwrite or normalization", async () => {
    const deps = createDeps();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;

    const responseV1 = makeOrcaPoolResponse({ tvlUsdc: "1000.00" });
    deps.http.setResponse(url, { body: responseV1 });
    const firstResult = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(firstResult.status).toBe("accepted");

    const responseV2 = makeOrcaPoolResponse({ tvlUsdc: "2000.00" }); // conflict! same observed timestamp, different data
    deps.http.setResponse(url, { body: responseV2 });
    const secondResult = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(secondResult.status).toBe("conflict");
    expect(secondResult.hasUsableEvidence).toBe(false);
  });

  it("marks accepted Orca raw content failed when normalization fails", async () => {
    const deps = createDeps();
    const response = makeOrcaPoolResponse();
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;
    deps.http.setResponse(url, { body: response });

    // Mock normalization to fail
    deps.normalizedObservationRepo.insertMany = async () => {
      throw new Error("Simulated normalization failure");
    };

    const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
    expect(result.status).toBe("failed");
    expect(result.rawObservationId).not.toBeNull();

    const rawRow = await deps.rawObservationRepo.findById(result.rawObservationId!);
    expect(rawRow!.parseStatus).toBe("failed");
  });

  it("classifies timeout network rate limit server error and invalid JSON safely", async () => {
    const url = `${ORCA_API_BASE}/public/pool?address=${DEFAULT_WHIRLPOOL_ADDRESS}&stats=24h`;

    // 1. Timeout
    {
      const deps = createDeps();
      deps.http.setResponse(url, {
        error: new HttpRequestError("timeout", "Timeout error", null, true)
      });
      const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
      expect(result.status).toBe("timeout");
      expect(result.diagnostic).toContain("Timeout error");
    }

    // 2. Network / connection failure
    {
      const deps = createDeps();
      deps.http.setResponse(url, {
        error: new HttpRequestError("network", "Connection failed", null, true)
      });
      const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
      expect(result.status).toBe("network");
    }

    // 3. Rate limit (429) or Server error (503) -> unavailable
    {
      const deps = createDeps();
      deps.http.setResponse(url, {
        error: new HttpRequestError("http_status", "Rate limited", 429, true)
      });
      const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
      expect(result.status).toBe("unavailable");
    }

    // 4. Invalid JSON
    {
      const deps = createDeps();
      // Invalid json is usually a JSON parsing error during body retrieval
      deps.http.getJson = async () => {
        throw new Error("Unexpected token < in JSON at position 0");
      };
      const result = await collectOrcaPoolStatistics(deps, VALID_CONTEXT);
      expect(result.status).toBe("malformed");
    }
  });
});
