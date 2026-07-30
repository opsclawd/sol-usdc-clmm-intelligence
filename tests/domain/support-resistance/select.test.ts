import { describe, it, expect } from "vitest";
import type { NormalizedObservationRow } from "../../../src/contracts/normalized-observation.js";
import type { SupportResistancePayloadV1 } from "../../../src/contracts/support-resistance.js";
import {
  selectSupportResistanceClaims,
  type SupportResistanceSelectionRequest,
  type SelectedSupportResistance
} from "../../../src/domain/support-resistance/index.js";

import { DEFAULT_PROVENANCE, DEFAULT_CONFIDENCE } from "../../helpers/taxonomy-fixtures.js";

interface CreateRowOptions {
  id?: number;
  source?: string;
  observationKind?: string;
  payload?: unknown;
  payloadHash?: string;
  confidenceComposite?: number;
  validUntilUnixMs?: number | null;
  isStale?: boolean;
  receivedAtUnixMs?: number;
  levelType?: "point" | "zone";
  levelUsdcPerSol?: number;
  zoneLowerUsdcPerSol?: number;
  zoneUpperUsdcPerSol?: number;
  evidenceSide?: "SUPPORT" | "RESISTANCE";
  timeframe?: string;
  thesisCodes?: readonly string[];
  asOfUnixMs?: number;
  expiresAtUnixMs?: number;
}

function createTestRow(options: CreateRowOptions = {}): NormalizedObservationRow {
  const id = options.id ?? 1;
  const asOfUnixMs = options.asOfUnixMs ?? 1_000_000;
  const expiresAtUnixMs = options.expiresAtUnixMs ?? 2_000_000;
  const levelType = options.levelType ?? "point";

  const defaultPayload: SupportResistancePayloadV1 = {
    kind: "support_resistance_level",
    schemaVersion: 1,
    pair: "SOL/USDC",
    unit: "USDC_PER_SOL",
    evidenceSide: options.evidenceSide ?? "SUPPORT",
    timeframe: options.timeframe ?? "1h",
    thesisCodes: options.thesisCodes ?? ["MA_BOUNCE"],
    asOfUnixMs,
    expiresAtUnixMs,
    invalidationConditions: [],
    warnings: [],
    sourceReferences: ["ref1"],
    sourceQuality: {
      providerId: "test-provider",
      reliability: 0.9,
      completeness: "complete"
    },
    ...(levelType === "point"
      ? { levelType: "point" as const, levelUsdcPerSol: options.levelUsdcPerSol ?? 150 }
      : {
          levelType: "zone" as const,
          zoneLowerUsdcPerSol: options.zoneLowerUsdcPerSol ?? 140,
          zoneUpperUsdcPerSol: options.zoneUpperUsdcPerSol ?? 160
        })
  };

  const payload = options.payload !== undefined ? options.payload : defaultPayload;
  const confidenceComposite = options.confidenceComposite ?? 0.8;
  const validUntilUnixMs =
    options.validUntilUnixMs !== undefined ? options.validUntilUnixMs : expiresAtUnixMs;

  return {
    id,
    rawObservationId: 100 + id,
    source: (options.source ?? "technical-analysis-api") as NormalizedObservationRow["source"],
    observationKind: (options.observationKind ??
      "support_resistance_level") as NormalizedObservationRow["observationKind"],
    signalClass: "contextual",
    evidenceFamily: "support_resistance",
    payload,
    payloadHash: options.payloadHash ?? `hash_${id}`,
    confidence: {
      ...DEFAULT_CONFIDENCE,
      components: {
        ...DEFAULT_CONFIDENCE.components,
        derivationConfidence: confidenceComposite
      },
      compositeScore: confidenceComposite
    },
    confidenceComposite,
    confidenceLevel: "high",
    validUntilUnixMs,
    isStale: options.isStale ?? false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    receivedAtUnixMs: options.receivedAtUnixMs ?? asOfUnixMs
  };
}

describe("selectSupportResistanceClaims", () => {
  it("excludes stale expired and future support resistance rows", () => {
    const evaluationTimeUnixMs = 1_500_000;

    const validRow = createTestRow({ id: 1, asOfUnixMs: 1_000_000, expiresAtUnixMs: 2_000_000 });
    const staleRow = createTestRow({ id: 2, isStale: true });
    const expiredValidUntilRow = createTestRow({ id: 3, validUntilUnixMs: 1_400_000 });
    const expiredPayloadRow = createTestRow({
      id: 4,
      expiresAtUnixMs: 1_400_000,
      validUntilUnixMs: 1_400_000
    });
    const futureRow = createTestRow({ id: 5, asOfUnixMs: 1_600_000 });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates: [validRow, staleRow, expiredValidUntilRow, expiredPayloadRow, futureRow],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results).toHaveLength(1);
    expect(results[0]!.row.id).toBe(1);
  });

  it("deduplicates equivalent point and zone claims with a stable winner", () => {
    const evaluationTimeUnixMs = 1_500_000;

    // Equivalent point claims: side SUPPORT, point 150, timeframe 1h, thesisCodes ['MA_BOUNCE']
    const pointRowLowConf = createTestRow({
      id: 1,
      levelType: "point",
      levelUsdcPerSol: 150,
      confidenceComposite: 0.5
    });
    const pointRowHighConf = createTestRow({
      id: 2,
      levelType: "point",
      levelUsdcPerSol: 150,
      confidenceComposite: 0.95
    });

    // Equivalent zone claims: side RESISTANCE, zone 160-170, timeframe 4h
    const zoneRowLowConf = createTestRow({
      id: 3,
      evidenceSide: "RESISTANCE",
      levelType: "zone",
      zoneLowerUsdcPerSol: 160,
      zoneUpperUsdcPerSol: 170,
      timeframe: "4h",
      confidenceComposite: 0.6
    });
    const zoneRowHighConf = createTestRow({
      id: 4,
      evidenceSide: "RESISTANCE",
      levelType: "zone",
      zoneLowerUsdcPerSol: 160,
      zoneUpperUsdcPerSol: 170,
      timeframe: "4h",
      confidenceComposite: 0.9
    });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates: [pointRowLowConf, pointRowHighConf, zoneRowLowConf, zoneRowHighConf],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results).toHaveLength(2);
    expect(results.map((r: SelectedSupportResistance) => r.row.id)).toEqual([2, 4]);
  });

  it("orders by valid current price proximity before confidence", () => {
    const evaluationTimeUnixMs = 1_500_000;
    const currentPriceUsdcPerSol = 150;

    // Row 1: point at 151 (distance 1), confidence 0.5
    const row1 = createTestRow({
      id: 1,
      levelType: "point",
      levelUsdcPerSol: 151,
      confidenceComposite: 0.5
    });

    // Row 2: point at 165 (distance 15), confidence 0.99
    const row2 = createTestRow({
      id: 2,
      levelType: "point",
      levelUsdcPerSol: 165,
      confidenceComposite: 0.99
    });

    // Row 3: zone 149-152 (price 150 inside zone -> distance 0), confidence 0.3
    const row3 = createTestRow({
      id: 3,
      levelType: "zone",
      zoneLowerUsdcPerSol: 149,
      zoneUpperUsdcPerSol: 152,
      confidenceComposite: 0.3
    });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      currentPriceUsdcPerSol,
      candidates: [row2, row1, row3],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results.map((r: SelectedSupportResistance) => r.row.id)).toEqual([3, 1, 2]);
  });

  it("falls back to confidence timeframe recency hash and row id without current price", () => {
    const evaluationTimeUnixMs = 1_500_000;

    const rowHighConf = createTestRow({
      id: 1,
      levelUsdcPerSol: 152,
      confidenceComposite: 0.9,
      timeframe: "4h",
      asOfUnixMs: 1_000_000
    });
    const rowHighestConf1h = createTestRow({
      id: 2,
      levelUsdcPerSol: 151,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_000_000
    });
    const rowHighestConf1hRecent = createTestRow({
      id: 3,
      levelUsdcPerSol: 150,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_200_000
    });
    const rowLowConf = createTestRow({
      id: 4,
      levelUsdcPerSol: 153,
      confidenceComposite: 0.6,
      timeframe: "1h",
      asOfUnixMs: 1_200_000
    });
    const rowSameTieHashA = createTestRow({
      id: 5,
      levelUsdcPerSol: 154,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_200_000,
      payloadHash: "hash_A"
    });
    const rowSameTieHashB = createTestRow({
      id: 6,
      levelUsdcPerSol: 155,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_200_000,
      payloadHash: "hash_B"
    });
    const rowSameTieId10 = createTestRow({
      id: 10,
      levelUsdcPerSol: 156,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_200_000,
      payloadHash: "same_hash"
    });
    const rowSameTieId11 = createTestRow({
      id: 11,
      levelUsdcPerSol: 157,
      confidenceComposite: 0.9,
      timeframe: "1h",
      asOfUnixMs: 1_200_000,
      payloadHash: "same_hash"
    });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates: [
        rowLowConf,
        rowHighConf,
        rowSameTieId11,
        rowSameTieHashB,
        rowHighestConf1h,
        rowHighestConf1hRecent,
        rowSameTieHashA,
        rowSameTieId10
      ],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results.map((r: SelectedSupportResistance) => r.row.id)).toEqual([
      3, 5, 6, 10, 11, 2, 1, 4
    ]);
  });

  it("keeps exact point and zone prices in the selected payload", () => {
    const evaluationTimeUnixMs = 1_500_000;

    const pointRow = createTestRow({
      id: 10,
      levelType: "point",
      levelUsdcPerSol: 155.45
    });
    const zoneRow = createTestRow({
      id: 11,
      levelType: "zone",
      zoneLowerUsdcPerSol: 140.1,
      zoneUpperUsdcPerSol: 145.2,
      evidenceSide: "RESISTANCE"
    });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates: [pointRow, zoneRow],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results).toHaveLength(2);

    const pointResult = results.find((r: SelectedSupportResistance) => r.row.id === 10);
    expect(pointResult?.payload.levelType).toBe("point");
    if (pointResult?.payload.levelType === "point") {
      expect(pointResult.payload.levelUsdcPerSol).toBe(155.45);
    }

    const zoneResult = results.find((r: SelectedSupportResistance) => r.row.id === 11);
    expect(zoneResult?.payload.levelType).toBe("zone");
    if (zoneResult?.payload.levelType === "zone") {
      expect(zoneResult.payload.zoneLowerUsdcPerSol).toBe(140.1);
      expect(zoneResult.payload.zoneUpperUsdcPerSol).toBe(145.2);
    }
  });

  it("never returns more than the requested operational cap", () => {
    const evaluationTimeUnixMs = 1_500_000;
    const candidates = Array.from({ length: 20 }, (_, i) =>
      createTestRow({ id: i + 1, levelUsdcPerSol: 100 + i })
    );

    const requestCap3: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates,
      maxItems: 3
    };
    expect(selectSupportResistanceClaims(requestCap3)).toHaveLength(3);

    const requestCap20: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates,
      maxItems: 20
    };
    // Operational cap is min(maxItems, 16)
    expect(selectSupportResistanceClaims(requestCap20)).toHaveLength(16);
  });

  it("ignores rows with the wrong source kind or malformed payload", () => {
    const evaluationTimeUnixMs = 1_500_000;

    const wrongSource = createTestRow({ id: 1, source: "on-chain-api" });
    const wrongKind = createTestRow({ id: 2, observationKind: "scheduled_event" });
    const invalidPayload = createTestRow({ id: 3, payload: { kind: "wrong_kind" } });
    const invertedZone = createTestRow({
      id: 4,
      levelType: "zone",
      zoneLowerUsdcPerSol: 160,
      zoneUpperUsdcPerSol: 140
    });
    const negativePoint = createTestRow({
      id: 5,
      levelType: "point",
      levelUsdcPerSol: -10
    });

    const request: SupportResistanceSelectionRequest = {
      evaluationTimeUnixMs,
      candidates: [wrongSource, wrongKind, invalidPayload, invertedZone, negativePoint],
      maxItems: 10
    };

    const results = selectSupportResistanceClaims(request);
    expect(results).toHaveLength(0);
  });
});
