import { describe, it, expect } from "vitest";
import type {
  ObservationKind,
  FeatureKind,
  EvidenceFamily,
  SignalClass,
  Source
} from "../../../src/contracts/taxonomy.js";
import {
  observationKindRegistry,
  featureKindRegistry,
  getObservationKindEntry,
  getFeatureKindEntry
} from "../../../src/domain/taxonomy/registry.js";

const VALID_EVIDENCE_FAMILIES: EvidenceFamily[] = [
  "clmm_state",
  "price_quality",
  "clmm_economics",
  "execution_safety",
  "market_regime",
  "support_resistance",
  "on_chain_flow",
  "perp_liquidation",
  "macro_protocol_risk"
];

const VALID_SIGNAL_CLASSES: SignalClass[] = ["deterministic", "probabilistic", "contextual"];

const VALID_SOURCES: Source[] = [
  "clmm-v2-bundle",
  "jupiter-price",
  "jupiter-price-v3",
  "coingecko",
  "defillama"
];

describe("observationKindRegistry", () => {
  const observationKinds: ObservationKind[] = [
    "pool_state",
    "position_state",
    "price_quote",
    "fee_metrics",
    "volume_metrics"
  ];

  it("has an entry for every ObservationKind union member", () => {
    for (const kind of observationKinds) {
      expect(observationKindRegistry).toHaveProperty(kind);
    }
  });

  it("every entry kind field matches its object key", () => {
    for (const kind of observationKinds) {
      expect(observationKindRegistry[kind].kind).toBe(kind);
    }
  });

  it("every entry has a valid evidenceFamily", () => {
    for (const kind of observationKinds) {
      expect(VALID_EVIDENCE_FAMILIES).toContain(observationKindRegistry[kind].evidenceFamily);
    }
  });

  it("every entry has a valid signalClass", () => {
    for (const kind of observationKinds) {
      expect(VALID_SIGNAL_CLASSES).toContain(observationKindRegistry[kind].signalClass);
    }
  });

  it("every entry has a valid source", () => {
    for (const kind of observationKinds) {
      expect(VALID_SOURCES).toContain(observationKindRegistry[kind].source);
    }
  });

  it("all active entries are active", () => {
    for (const kind of observationKinds) {
      expect(observationKindRegistry[kind].active).toBe(true);
    }
  });

  it("every entry freshnessPolicy has positive maxObservedAgeMs", () => {
    for (const kind of observationKinds) {
      expect(observationKindRegistry[kind].freshnessPolicy.maxObservedAgeMs).toBeGreaterThan(0);
    }
  });

  it("every entry confidencePolicy weights sum to 1.0", () => {
    for (const kind of observationKinds) {
      const w = observationKindRegistry[kind].confidencePolicy.weights;
      const sum =
        w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    }
  });
});

describe("featureKindRegistry", () => {
  const featureKinds: FeatureKind[] = [
    "fee_apr",
    "oracle_divergence",
    "volatility_24h",
    "liquidity_depth"
  ];

  it("has an entry for every FeatureKind union member", () => {
    for (const kind of featureKinds) {
      expect(featureKindRegistry).toHaveProperty(kind);
    }
  });

  it("every entry kind field matches its object key", () => {
    for (const kind of featureKinds) {
      expect(featureKindRegistry[kind].kind).toBe(kind);
    }
  });

  it("every entry has a valid evidenceFamily", () => {
    for (const kind of featureKinds) {
      expect(VALID_EVIDENCE_FAMILIES).toContain(featureKindRegistry[kind].evidenceFamily);
    }
  });

  it("every entry has a valid signalClass", () => {
    for (const kind of featureKinds) {
      expect(VALID_SIGNAL_CLASSES).toContain(featureKindRegistry[kind].signalClass);
    }
  });

  it("all active entries are active", () => {
    for (const kind of featureKinds) {
      expect(featureKindRegistry[kind].active).toBe(true);
    }
  });

  it("every entry confidencePolicy weights sum to 1.0", () => {
    for (const kind of featureKinds) {
      const w = featureKindRegistry[kind].confidencePolicy.weights;
      const sum =
        w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    }
  });
});

describe("getObservationKindEntry", () => {
  it("returns entry for pool_state", () => {
    const entry = getObservationKindEntry("pool_state");
    expect(entry.kind).toBe("pool_state");
    expect(entry.evidenceFamily).toBe("clmm_state");
  });
});

describe("getFeatureKindEntry", () => {
  it("returns entry for fee_apr", () => {
    const entry = getFeatureKindEntry("fee_apr");
    expect(entry.kind).toBe("fee_apr");
    expect(entry.evidenceFamily).toBe("clmm_economics");
  });
});
