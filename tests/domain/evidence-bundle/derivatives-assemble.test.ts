import { describe, it, expect } from "vitest";
import {
  hasUsableDerivativeSlots,
  buildDerivativeClaims
} from "../../../src/domain/evidence-bundle/derivatives.js";
import { assembleEvidenceBundleCandidate } from "../../../src/domain/evidence-bundle/assemble.js";
import { classifyEvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
import { createEvidenceBundleContract } from "../../../src/adapters/node/evidence-bundle-v1-contract.js";
import { MVP_FEATURE_KINDS } from "../../../src/contracts/derived-feature.js";
import type {
  SelectedFeatureSlot,
  SelectedAvailableSlot,
  SelectedPartialSlot,
  SelectedUnavailableSlot,
  MissingSlot,
  ExpiredOnlySlot,
  UnsupportedVersionOnlySlot
} from "../../../src/domain/evidence-bundle/select.js";
import type { Confidence, Provenance, FeatureKind } from "../../../src/contracts/taxonomy.js";
import type { Scope } from "../../../src/contracts/generated/evidence-bundle-v1.js";

const DEFAULT_CONFIDENCE: Confidence = {
  components: {
    sourceReliability: 0.9,
    dataCompleteness: 1.0,
    derivationConfidence: 0.95,
    llmConfidence: null
  },
  compositeScore: 8500,
  level: "high",
  weightingVersion: "v1",
  reasons: []
};

function makeRawProvenance(rawIds: number[]): Provenance {
  return {
    sourceRefs: [],
    rawObservationRefs: rawIds.map((id) => ({
      refType: "raw_observation",
      id,
      source: "binance-fapi",
      payloadHash: `hash-${id}`
    })),
    derivedFromRefs: [],
    processRef: {
      collector: "test",
      jobName: "test",
      pipelineRunId: null,
      codeVersion: null,
      modelVersion: null
    },
    codeVersion: "test",
    runId: null
  };
}

function makeAvailableSlot(
  featureKind: FeatureKind,
  rowId: number,
  value: number,
  rawIds: number[] = [41],
  confidence: Confidence = DEFAULT_CONFIDENCE,
  asOfUnixMs = 1700000000000,
  validUntilUnixMs: number | null = 1700003600000
): SelectedAvailableSlot {
  return {
    featureKind,
    outcome: "selected_available",
    rowId,
    value,
    confidence,
    provenance: makeRawProvenance(rawIds),
    warnings: [],
    reasons: [],
    asOfUnixMs,
    validUntilUnixMs
  };
}

function makePartialSlot(
  featureKind: FeatureKind,
  rowId: number,
  value: number,
  rawIds: number[] = [42],
  confidence: Confidence = DEFAULT_CONFIDENCE,
  asOfUnixMs = 1700000000000,
  validUntilUnixMs: number | null = 1700003600000
): SelectedPartialSlot {
  return {
    featureKind,
    outcome: "selected_partial",
    rowId,
    value,
    confidence,
    provenance: makeRawProvenance(rawIds),
    warnings: ["partial_degraded"],
    reasons: [],
    asOfUnixMs,
    validUntilUnixMs
  };
}

function makeUnavailableSlot(
  featureKind: FeatureKind,
  rowId: number,
  rawIds: number[] = [43]
): SelectedUnavailableSlot {
  return {
    featureKind,
    outcome: "selected_unavailable",
    rowId,
    confidence: DEFAULT_CONFIDENCE,
    provenance: makeRawProvenance(rawIds),
    warnings: ["unavailable"],
    reasons: ["no_data"],
    asOfUnixMs: 1700000000000,
    validUntilUnixMs: 1700003600000
  };
}

function makeMissingSlot(featureKind: FeatureKind): MissingSlot {
  return {
    featureKind,
    outcome: "missing"
  };
}

function makeExpiredSlot(featureKind: FeatureKind, rowId: number): ExpiredOnlySlot {
  return {
    featureKind,
    outcome: "expired_only",
    rowId
  };
}

function makeUnsupportedSlot(featureKind: FeatureKind, rowId: number): UnsupportedVersionOnlySlot {
  return {
    featureKind,
    outcome: "unsupported_version_only",
    rowId
  };
}

function buildMvpSlots(
  overrides: Partial<Record<FeatureKind, SelectedFeatureSlot>>
): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((kind, idx) => {
    if (overrides[kind]) {
      return overrides[kind]!;
    }
    return makeAvailableSlot(kind, idx + 100, 10);
  });
}

const DEFAULT_SCOPE: Scope = {
  kind: "whirlpool",
  network: "solana-mainnet",
  whirlpoolAddress: "whirlpool-11111111111111111111111111111111"
};

describe("derivatives claim mapper and assembly", () => {
  it("emits one canonical claim for each usable representable derivative slot", async () => {
    const fundingSlot = makeAvailableSlot("funding_rate_annualized", 8, 150, [41]);
    const oiSlot = makePartialSlot("oi_trend_4h", 9, -200, [42]);
    const liqSlot = makeAvailableSlot("liquidation_cluster_1h", 10, 50, [43]);

    const slots = [fundingSlot, oiSlot, liqSlot];

    expect(hasUsableDerivativeSlots(slots)).toBe(true);

    const claims = buildDerivativeClaims(slots);
    expect(claims).toHaveLength(3);

    expect(claims[0]).toEqual({
      evidenceId: "derivative-funding_rate_annualized-8",
      kind: "funding",
      claim: "funding_rate_annualized: +150 BPS (annualized)",
      direction: "bullish",
      confidenceBps: 8500,
      observedAt: "2023-11-14T22:13:20.000Z",
      expiresAt: "2023-11-14T23:13:20.000Z",
      sourceReferenceIds: ["raw-41"],
      provenanceMethod: "derived"
    });

    expect(claims[1]).toEqual({
      evidenceId: "derivative-oi_trend_4h-9",
      kind: "open_interest",
      claim: "oi_trend_4h: -200 BPS (4h)",
      direction: "bearish",
      confidenceBps: 8500,
      observedAt: "2023-11-14T22:13:20.000Z",
      expiresAt: "2023-11-14T23:13:20.000Z",
      sourceReferenceIds: ["raw-42"],
      provenanceMethod: "derived"
    });

    expect(claims[2]).toEqual({
      evidenceId: "derivative-liquidation_cluster_1h-10",
      kind: "liquidation",
      claim: "liquidation_cluster_1h: +50 BPS (1h)",
      direction: "mixed",
      confidenceBps: 8500,
      observedAt: "2023-11-14T22:13:20.000Z",
      expiresAt: "2023-11-14T23:13:20.000Z",
      sourceReferenceIds: ["raw-43"],
      provenanceMethod: "derived"
    });

    const mvpSlots = buildMvpSlots({
      funding_rate_annualized: fundingSlot,
      oi_trend_4h: oiSlot,
      liquidation_cluster_1h: liqSlot
    });

    const quality = classifyEvidenceBundleQuality({
      slots: mvpSlots,
      runId: "run-1",
      correlationId: "corr-1",
      createdAt: 1700000000000,
      asOf: 1700000000000,
      freshUntil: 1700003600000,
      expiresAt: 1700007200000,
      hasSupportResistance: false,
      hasFlows: false,
      hasDerivatives: hasUsableDerivativeSlots(mvpSlots),
      hasEvents: false,
      hasNewsRegulatory: false,
      hasResearchBrief: false
    });

    const candidate = assembleEvidenceBundleCandidate({
      scope: DEFAULT_SCOPE,
      slots: mvpSlots,
      quality,
      lineage: {
        rawObservationIds: [41, 42, 43],
        normalizedObservationIds: [1, 2, 3],
        sourceReferences: [
          {
            referenceId: "raw-41",
            sourceType: "api",
            locator: "loc-41",
            observedAt: "2023-11-14T22:13:20.000Z"
          },
          {
            referenceId: "raw-42",
            sourceType: "api",
            locator: "loc-42",
            observedAt: "2023-11-14T22:13:20.000Z"
          },
          {
            referenceId: "raw-43",
            sourceType: "api",
            locator: "loc-43",
            observedAt: "2023-11-14T22:13:20.000Z"
          }
        ]
      },
      runId: "run-1",
      correlationId: "corr-1",
      createdAt: 1700000000000,
      asOf: 1700000000000,
      freshUntil: 1700003600000,
      expiresAt: 1700007200000,
      briefPresent: false,
      pipelineVersion: "1.0.0",
      gitCommit: "0000000000000000000000000000000000000000000000000000000000000000",
      environment: "test",
      contextualEvents: []
    });

    expect(candidate.contextualEvidence.derivatives).toHaveLength(3);
    const contract = createEvidenceBundleContract();
    const canonical = await contract.validateCanonicalizeAndHash(candidate);
    expect(canonical.schemaVersion).toBe("evidence-bundle.v1");
  });

  it("maps funding and open interest signs to bullish bearish and neutral", () => {
    const bullishFunding = makeAvailableSlot("funding_rate_annualized", 1, 100);
    const bearishFunding = makeAvailableSlot("funding_rate_annualized", 2, -50);
    const neutralFunding = makeAvailableSlot("funding_rate_annualized", 3, 0);

    const bullishOi = makeAvailableSlot("oi_trend_4h", 4, 200);
    const bearishOi = makeAvailableSlot("oi_trend_4h", 5, -150);
    const neutralOi = makeAvailableSlot("oi_trend_4h", 6, 0);

    const claims = buildDerivativeClaims([
      bullishFunding,
      bearishFunding,
      neutralFunding,
      bullishOi,
      bearishOi,
      neutralOi
    ]);

    expect(claims[0]!.direction).toBe("bullish");
    expect(claims[0]!.claim).toBe("funding_rate_annualized: +100 BPS (annualized)");

    expect(claims[1]!.direction).toBe("bearish");
    expect(claims[1]!.claim).toBe("funding_rate_annualized: -50 BPS (annualized)");

    expect(claims[2]!.direction).toBe("neutral");
    expect(claims[2]!.claim).toBe("funding_rate_annualized: 0 BPS (annualized)");

    expect(claims[3]!.direction).toBe("bullish");
    expect(claims[3]!.claim).toBe("oi_trend_4h: +200 BPS (4h)");

    expect(claims[4]!.direction).toBe("bearish");
    expect(claims[4]!.claim).toBe("oi_trend_4h: -150 BPS (4h)");

    expect(claims[5]!.direction).toBe("neutral");
    expect(claims[5]!.claim).toBe("oi_trend_4h: 0 BPS (4h)");
  });

  it("keeps liquidation direction mixed when activity exists and neutral when zero", () => {
    const activeLiq = makeAvailableSlot("liquidation_cluster_1h", 1, 75);
    const zeroLiq = makeAvailableSlot("liquidation_cluster_1h", 2, 0);

    const claims = buildDerivativeClaims([activeLiq, zeroLiq]);

    expect(claims[0]!.direction).toBe("mixed");
    expect(claims[0]!.claim).toBe("liquidation_cluster_1h: +75 BPS (1h)");

    expect(claims[1]!.direction).toBe("neutral");
    expect(claims[1]!.claim).toBe("liquidation_cluster_1h: 0 BPS (1h)");
  });

  it("omits unavailable expired unsupported missing and unresolvable derivative slots", () => {
    const unavail = makeUnavailableSlot("funding_rate_annualized", 1);
    const expired = makeExpiredSlot("oi_trend_4h", 2);
    const unsupported = makeUnsupportedSlot("liquidation_cluster_1h", 3);
    const missing = makeMissingSlot("funding_rate_annualized");

    const noRawProvSlot: SelectedAvailableSlot = {
      ...makeAvailableSlot("funding_rate_annualized", 4, 100),
      provenance: {
        ...makeRawProvenance([]),
        rawObservationRefs: []
      }
    };

    const slots = [unavail, expired, unsupported, missing, noRawProvSlot];

    expect(hasUsableDerivativeSlots(slots)).toBe(false);
    expect(buildDerivativeClaims(slots)).toHaveLength(0);
  });

  it("keeps basis spread deterministic only", () => {
    const basisSlot = makeAvailableSlot("basis_spread_bps", 1, 50, [10]);

    expect(hasUsableDerivativeSlots([basisSlot])).toBe(false);
    expect(buildDerivativeClaims([basisSlot])).toHaveLength(0);
  });

  it("converts confidence timestamps expiry and lineage without widening provenance", () => {
    const highConf: Confidence = {
      ...DEFAULT_CONFIDENCE,
      compositeScore: 9250
    };
    const overConf: Confidence = {
      ...DEFAULT_CONFIDENCE,
      compositeScore: 15000
    };

    const slot1 = makeAvailableSlot(
      "funding_rate_annualized",
      5,
      120,
      [41, 12, 41],
      highConf,
      1700000000000,
      1700003600000
    );

    const slot2 = makeAvailableSlot("oi_trend_4h", 6, -30, [99], overConf, 1700000000000, null);

    const claims = buildDerivativeClaims([slot1, slot2]);

    expect(claims[0]!.confidenceBps).toBe(9250);
    expect(claims[0]!.observedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(claims[0]!.expiresAt).toBe("2023-11-14T23:13:20.000Z");
    expect(claims[0]!.sourceReferenceIds).toEqual(["raw-12", "raw-41"]);

    expect(claims[1]!.confidenceBps).toBe(10000);
    expect(claims[1]!.expiresAt).toBeNull();
    expect(claims[1]!.sourceReferenceIds).toEqual(["raw-99"]);
  });
});
