import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import type { DerivedFeatureRepo } from "../../src/ports/feature-repo.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { PerpLiquidationSourcePort } from "../../src/ports/perp-liquidation-source.js";
import type { PerpLiquidationCollectionResult } from "../../src/application/collect-perp-liquidation.js";
const mockCreateCollectionRunContext = vi.fn();
vi.mock("../../src/application/create-collection-run-context.js", () => {
  return {
    createCollectionRunContext: (args: unknown) => mockCreateCollectionRunContext(args)
  };
});

const mockCollectPerpLiquidation = vi.fn();
vi.mock("../../src/application/collect-perp-liquidation.js", () => {
  return {
    collectPerpLiquidation: (deps: unknown, context: unknown, input: unknown) =>
      mockCollectPerpLiquidation(deps, context, input)
  };
});

import {
  runPerpLiquidationJob,
  type ConfiguredPerpLiquidationSource
} from "../../src/jobs/perp-liquidation-job.js";

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-context-123",
  startedAtUnixMs: 1704067200000
});

const DRIFT_PRECISION = Object.freeze({
  pricePrecision: "1000000",
  basePrecision: "1000000000",
  quotePrecision: "1000000"
});

const LOOKBACK_MS = 14_400_000;

function makeSourcePort(): PerpLiquidationSourcePort {
  return {
    collect: vi.fn()
  } as unknown as PerpLiquidationSourcePort;
}

function makeJobDeps(sources: readonly ConfiguredPerpLiquidationSource[]) {
  return {
    sources,
    rawObservationRepo: {
      insertOrClassify: vi.fn(),
      findById: vi.fn(),
      updateParseStatus: vi.fn()
    } as unknown as RawObservationRepo,
    normalizedObservationRepo: {
      insertMany: vi.fn(),
      findBySource: vi.fn()
    } as unknown as NormalizedObservationRepo,
    derivedFeatureRepo: {
      insertMany: vi.fn(),
      findByRunId: vi.fn()
    } as unknown as DerivedFeatureRepo,
    env: {
      get: vi.fn(),
      getOptional: vi.fn()
    },
    clock: {
      now: vi.fn()
    },
    runIdFactory: {
      nextRunId: vi.fn()
    },
    binanceSymbol: "SOLUSDT",
    driftMarketIndex: 0,
    driftPrecision: DRIFT_PRECISION,
    lookbackMs: LOOKBACK_MS
  };
}

const USABLE_RESULT: PerpLiquidationCollectionResult = {
  venue: "binance-fapi",
  status: "accepted",
  rawCount: 5,
  normalizedCount: 5,
  featureCount: 2,
  coverage: {
    funding_rate: { kind: "funding_rate", status: "available" },
    open_interest: { kind: "open_interest", status: "available" },
    perp_basis: { kind: "perp_basis", status: "available" },
    liquidation_event: { kind: "liquidation_event", status: "available" },
    leverage_proxy: { kind: "leverage_proxy", status: "available" }
  }
};

const UNAVAILABLE_RESULT: PerpLiquidationCollectionResult = {
  venue: "binance-fapi",
  status: "unavailable",
  rawCount: 0,
  normalizedCount: 0,
  featureCount: 0,
  coverage: {
    funding_rate: { kind: "funding_rate", status: "unavailable", diagnostic: "Unavailable" },
    open_interest: { kind: "open_interest", status: "unavailable", diagnostic: "Unavailable" },
    perp_basis: { kind: "perp_basis", status: "unavailable", diagnostic: "Unavailable" },
    liquidation_event: {
      kind: "liquidation_event",
      status: "unavailable",
      diagnostic: "Unavailable"
    },
    leverage_proxy: { kind: "leverage_proxy", status: "unavailable", diagnostic: "Unavailable" }
  }
};

describe("perpLiquidationJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateCollectionRunContext.mockReturnValue(VALID_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions one unavailable venue plus one usable venue to PARTIAL without failing the command", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };
    const driftSource: ConfiguredPerpLiquidationSource = {
      source: "drift-api",
      adapter: makeSourcePort()
    };

    mockCollectPerpLiquidation.mockImplementation((_deps, _ctx, input: { venue: string }) => {
      if (input.venue === "binance-fapi") {
        return Promise.resolve(USABLE_RESULT);
      }
      return Promise.resolve(UNAVAILABLE_RESULT);
    });

    const deps = makeJobDeps([binanceSource, driftSource]);
    const result = await runPerpLiquidationJob(deps);

    expect(result.status).toBe("PARTIAL");
    expect(result.shouldFailCommand).toBe(false);
  });

  it("transitions two unavailable venues to UNAVAILABLE and fails the command", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };
    const driftSource: ConfiguredPerpLiquidationSource = {
      source: "drift-api",
      adapter: makeSourcePort()
    };

    mockCollectPerpLiquidation.mockResolvedValue(UNAVAILABLE_RESULT);

    const deps = makeJobDeps([binanceSource, driftSource]);
    const result = await runPerpLiquidationJob(deps);

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.shouldFailCommand).toBe(true);
  });

  it("sorts source outcomes deterministically", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };
    const driftSource: ConfiguredPerpLiquidationSource = {
      source: "drift-api",
      adapter: makeSourcePort()
    };

    mockCollectPerpLiquidation.mockResolvedValue(USABLE_RESULT);

    // Pass in drift first, binance second
    const deps = makeJobDeps([driftSource, binanceSource]);
    const result = await runPerpLiquidationJob(deps);

    expect(result.outcomes[0]!.source).toBe("binance-fapi");
    expect(result.outcomes[1]!.source).toBe("drift-api");
  });

  it("rejects duplicate or incomplete two-source configuration", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };

    // Missing drift
    const depsMissing = makeJobDeps([binanceSource]);
    await expect(runPerpLiquidationJob(depsMissing)).rejects.toThrow();

    // Duplicate binance
    const depsDup = makeJobDeps([binanceSource, binanceSource]);
    await expect(runPerpLiquidationJob(depsDup)).rejects.toThrow();
  });

  it("redacts source secrets from job and script diagnostics", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };
    const driftSource: ConfiguredPerpLiquidationSource = {
      source: "drift-api",
      adapter: makeSourcePort()
    };

    mockCollectPerpLiquidation.mockImplementation((_deps, _ctx, input: { venue: string }) => {
      if (input.venue === "binance-fapi") {
        return Promise.reject(new Error("Failed with secret secret_key_12345678901234567890"));
      }
      return Promise.resolve(USABLE_RESULT);
    });

    const deps = makeJobDeps([binanceSource, driftSource]);
    const result = await runPerpLiquidationJob(deps);

    const binanceOutcome = result.outcomes.find((o) => o.source === "binance-fapi");
    expect(binanceOutcome?.diagnostic ?? "").not.toContain("secret_key_12345678901234567890");
    expect(binanceOutcome?.diagnostic ?? "").toContain("[REDACTED");
  });

  it("sets exit code zero for COMPLETE and PARTIAL and one for UNAVAILABLE and FAILED", async () => {
    const binanceSource: ConfiguredPerpLiquidationSource = {
      source: "binance-fapi",
      adapter: makeSourcePort()
    };
    const driftSource: ConfiguredPerpLiquidationSource = {
      source: "drift-api",
      adapter: makeSourcePort()
    };

    const deps = makeJobDeps([binanceSource, driftSource]);

    // COMPLETE -> false
    mockCollectPerpLiquidation.mockResolvedValue(USABLE_RESULT);
    const completeRes = await runPerpLiquidationJob(deps);
    expect(completeRes.status).toBe("COMPLETE");
    expect(completeRes.shouldFailCommand).toBe(false);

    // PARTIAL -> false
    mockCollectPerpLiquidation.mockImplementation((_deps, _ctx, input: { venue: string }) => {
      if (input.venue === "binance-fapi") return Promise.resolve(USABLE_RESULT);
      return Promise.resolve(UNAVAILABLE_RESULT);
    });
    const partialRes = await runPerpLiquidationJob(deps);
    expect(partialRes.status).toBe("PARTIAL");
    expect(partialRes.shouldFailCommand).toBe(false);

    // UNAVAILABLE -> true
    mockCollectPerpLiquidation.mockResolvedValue(UNAVAILABLE_RESULT);
    const unavailRes = await runPerpLiquidationJob(deps);
    expect(unavailRes.status).toBe("UNAVAILABLE");
    expect(unavailRes.shouldFailCommand).toBe(true);

    // FAILED -> true
    mockCollectPerpLiquidation.mockResolvedValue({
      status: "failed",
      accepted: 0,
      filtered: 0,
      replayed: 0,
      failed: 1,
      conflict: 0,
      sourceObservationId: null,
      sourceObservationKey: null,
      results: []
    });
    const failedRes = await runPerpLiquidationJob(deps);
    expect(failedRes.status).toBe("FAILED");
    expect(failedRes.shouldFailCommand).toBe(true);
  });
});
