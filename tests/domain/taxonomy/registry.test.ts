import { describe, it, expect } from "vitest";
import type {
  ObservationKind,
  FeatureKind,
  EvidenceFamily,
  SignalClass
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

describe("observationKindRegistry", () => {
  const observationKinds: ObservationKind[] = [
    "pool_state",
    "position_state",
    "oracle_price",
    "executable_quote",
    "fee_metrics",
    "volume_metrics",
    "trigger_event",
    "data_quality"
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

  it("no entry has a singular source field (source-independent)", () => {
    for (const kind of observationKinds) {
      expect(observationKindRegistry[kind]).not.toHaveProperty("source");
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

describe("trigger_event and data_quality are deterministic execution_safety kinds with 60-second exclude-on-stale policies", () => {
  const triggerEntry = getObservationKindEntry("trigger_event");
  const dataQualityEntry = getObservationKindEntry("data_quality");

  it("trigger_event is deterministic execution_safety", () => {
    expect(triggerEntry.signalClass).toBe("deterministic");
    expect(triggerEntry.evidenceFamily).toBe("execution_safety");
  });

  it("trigger_event has 60-second max age, 5-second skew, exclude stale behavior", () => {
    expect(triggerEntry.freshnessPolicy.maxObservedAgeMs).toBe(60_000);
    expect(triggerEntry.freshnessPolicy.clockSkewToleranceMs).toBe(5_000);
    expect(triggerEntry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("data_quality is deterministic execution_safety", () => {
    expect(dataQualityEntry.signalClass).toBe("deterministic");
    expect(dataQualityEntry.evidenceFamily).toBe("execution_safety");
  });

  it("data_quality has 60-second max age, 5-second skew, exclude stale behavior", () => {
    expect(dataQualityEntry.freshnessPolicy.maxObservedAgeMs).toBe(60_000);
    expect(dataQualityEntry.freshnessPolicy.clockSkewToleranceMs).toBe(5_000);
    expect(dataQualityEntry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("both use schema version 1", () => {
    expect(triggerEntry.schemaVersion).toBe(1);
    expect(dataQualityEntry.schemaVersion).toBe(1);
  });

  it("both are active", () => {
    expect(triggerEntry.active).toBe(true);
    expect(dataQualityEntry.active).toBe(true);
  });

  it("both allow direct provenance with clmm-v2-bundle source", () => {
    expect(triggerEntry.provenanceRequirements.allowedSourceRefs).toContain("clmm-v2-bundle");
    expect(dataQualityEntry.provenanceRequirements.allowedSourceRefs).toContain("clmm-v2-bundle");
  });
});

describe("registers source-independent price kinds with exclude-on-stale policies", () => {
  const oraclePriceEntry = getObservationKindEntry("oracle_price");
  const executableQuoteEntry = getObservationKindEntry("executable_quote");

  it("oracle_price is deterministic price_quality", () => {
    expect(oraclePriceEntry.signalClass).toBe("deterministic");
    expect(oraclePriceEntry.evidenceFamily).toBe("price_quality");
  });

  it("oracle_price has 60-second publish-time window with exclude stale behavior", () => {
    expect(oraclePriceEntry.freshnessPolicy.maxObservedAgeMs).toBe(60_000);
    expect(oraclePriceEntry.freshnessPolicy.clockSkewToleranceMs).toBe(5_000);
    expect(oraclePriceEntry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("executable_quote is deterministic price_quality", () => {
    expect(executableQuoteEntry.signalClass).toBe("deterministic");
    expect(executableQuoteEntry.evidenceFamily).toBe("price_quality");
  });

  it("executable_quote has 30-second receipt-time window with exclude stale behavior", () => {
    expect(executableQuoteEntry.freshnessPolicy.maxObservedAgeMs).toBe(30_000);
    expect(executableQuoteEntry.freshnessPolicy.clockSkewToleranceMs).toBe(5_000);
    expect(executableQuoteEntry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("both use schema version 1 and are active", () => {
    expect(oraclePriceEntry.schemaVersion).toBe(1);
    expect(executableQuoteEntry.schemaVersion).toBe(1);
    expect(oraclePriceEntry.active).toBe(true);
    expect(executableQuoteEntry.active).toBe(true);
  });

  it("both have no singular source field (source-independent)", () => {
    expect(oraclePriceEntry).not.toHaveProperty("source");
    expect(executableQuoteEntry).not.toHaveProperty("source");
  });

  it("oracle_price allows pyth-hermes and jupiter-quote as provenance sources", () => {
    expect(oraclePriceEntry.provenanceRequirements.allowedSourceRefs).toContain("pyth-hermes");
    expect(oraclePriceEntry.provenanceRequirements.allowedSourceRefs).toContain("jupiter-quote");
  });

  it("executable_quote allows pyth-hermes and jupiter-quote as provenance sources", () => {
    expect(executableQuoteEntry.provenanceRequirements.allowedSourceRefs).toContain("pyth-hermes");
    expect(executableQuoteEntry.provenanceRequirements.allowedSourceRefs).toContain(
      "jupiter-quote"
    );
  });
});
