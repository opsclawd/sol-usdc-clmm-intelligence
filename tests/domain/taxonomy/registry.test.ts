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
  "macro_protocol_risk",
  "news_evidence"
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
    "data_quality",
    "pool_statistics",
    "support_resistance_level",
    "ecosystem_news",
    "regulatory_risk"
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
    "range_location",
    "distance_to_lower",
    "distance_to_upper",
    "oracle_dex_divergence",
    "oracle_confidence_width",
    "realized_volatility_1h",
    "volume_liquidity_ratio_24h"
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
  it("returns entry for range_location", () => {
    const entry = getFeatureKindEntry("range_location");
    expect(entry.kind).toBe("range_location");
    expect(entry.evidenceFamily).toBe("clmm_state");
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

  it("oracle_price allows pyth-hermes, jupiter-price, and jupiter-price-v3 as provenance sources", () => {
    expect(oraclePriceEntry.provenanceRequirements.allowedSourceRefs).toContain("pyth-hermes");
    expect(oraclePriceEntry.provenanceRequirements.allowedSourceRefs).toContain("jupiter-price");
    expect(oraclePriceEntry.provenanceRequirements.allowedSourceRefs).toContain("jupiter-price-v3");
  });

  it("executable_quote allows jupiter-quote as provenance source", () => {
    expect(executableQuoteEntry.provenanceRequirements.allowedSourceRefs).toContain(
      "jupiter-quote"
    );
    expect(executableQuoteEntry.provenanceRequirements.allowedSourceRefs).not.toContain(
      "pyth-hermes"
    );
  });
});

describe("pool_statistics registry", () => {
  it("registers pool statistics as five-minute degrade-on-stale clmm economics", () => {
    const entry = getObservationKindEntry("pool_statistics");
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("pool_statistics");
    expect(entry.evidenceFamily).toBe("clmm_economics");
    expect(entry.signalClass).toBe("deterministic");
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(300_000);
    expect(entry.freshnessPolicy.clockSkewToleranceMs).toBe(5_000);
    expect(entry.freshnessPolicy.staleBehavior).toBe("degrade_confidence");
    expect(entry.confidencePolicy.weights.sourceReliability).toBe(0.4);
    expect(entry.confidencePolicy.weights.dataCompleteness).toBe(0.3);
    expect(entry.confidencePolicy.weights.derivationConfidence).toBe(0.3);
    expect(entry.confidencePolicy.weights.llmConfidence).toBe(0);
    expect(entry.active).toBe(true);
    expect(entry.schemaVersion).toBe(1);
  });

  it("allows only orca public api provenance for pool statistics", () => {
    const entry = getObservationKindEntry("pool_statistics");
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["orca-public-api"]);
  });
});

describe("registers support resistance as contextual support_resistance evidence", () => {
  const entry = getObservationKindEntry("support_resistance_level");

  it("support_resistance_level is registered", () => {
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("support_resistance_level");
  });

  it("evidence family is support_resistance", () => {
    expect(entry.evidenceFamily).toBe("support_resistance");
  });

  it("signal class is contextual", () => {
    expect(entry.signalClass).toBe("contextual");
  });

  it("stale behavior is allow_context_only", () => {
    expect(entry.freshnessPolicy.staleBehavior).toBe("allow_context_only");
  });

  it("schema version is 1", () => {
    expect(entry.schemaVersion).toBe(1);
  });

  it("only technical-analysis-api is allowed as direct source ref", () => {
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["technical-analysis-api"]);
  });

  it("is active", () => {
    expect(entry.active).toBe(true);
  });

  it("has 24-hour maximum observed age", () => {
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(86_400_000);
  });

  it("has source-expiry-aware freshness with null maxFetchLag", () => {
    expect(entry.freshnessPolicy.maxFetchLagMs).toBeNull();
    expect(entry.freshnessPolicy.validForMs).toBeNull();
  });

  it("has confidence weights sourceReliability 0.45, completeness 0.35, derivation 0.20, llm 0", () => {
    expect(entry.confidencePolicy.weights.sourceReliability).toBe(0.45);
    expect(entry.confidencePolicy.weights.dataCompleteness).toBe(0.35);
    expect(entry.confidencePolicy.weights.derivationConfidence).toBe(0.2);
    expect(entry.confidencePolicy.weights.llmConfidence).toBe(0);
  });
});

describe("registers scheduled_event as contextual macro_protocol_risk evidence", () => {
  const entry = getObservationKindEntry("scheduled_event");

  it("scheduled_event is registered", () => {
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("scheduled_event");
  });

  it("evidence family is macro_protocol_risk", () => {
    expect(entry.evidenceFamily).toBe("macro_protocol_risk");
  });

  it("signal class is contextual", () => {
    expect(entry.signalClass).toBe("contextual");
  });

  it("stale behavior is exclude", () => {
    expect(entry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("schema version is 1", () => {
    expect(entry.schemaVersion).toBe(1);
  });

  it("only macro-calendar-api is allowed as direct source ref", () => {
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["macro-calendar-api"]);
  });

  it("is active", () => {
    expect(entry.active).toBe(true);
  });

  it("has 24-hour maximum observed age for scheduled feed refresh", () => {
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(86_400_000);
  });

  it("has source-provided expiry as tighter bound with null maxFetchLag", () => {
    expect(entry.freshnessPolicy.maxFetchLagMs).toBeNull();
    expect(entry.freshnessPolicy.validForMs).toBeNull();
  });

  it("has confidence weights summing to 1.0", () => {
    const w = entry.confidencePolicy.weights;
    const sum = w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});

describe("registers protocol_incident as contextual macro_protocol_risk evidence", () => {
  const entry = getObservationKindEntry("protocol_incident");

  it("protocol_incident is registered", () => {
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("protocol_incident");
  });

  it("evidence family is macro_protocol_risk", () => {
    expect(entry.evidenceFamily).toBe("macro_protocol_risk");
  });

  it("signal class is contextual", () => {
    expect(entry.signalClass).toBe("contextual");
  });

  it("stale behavior is exclude", () => {
    expect(entry.freshnessPolicy.staleBehavior).toBe("exclude");
  });

  it("schema version is 1", () => {
    expect(entry.schemaVersion).toBe(1);
  });

  it("only solana-status-api is allowed as direct source ref", () => {
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["solana-status-api"]);
  });

  it("is active", () => {
    expect(entry.active).toBe(true);
  });

  it("has 15-minute maximum observed age for incident feed refresh", () => {
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(900_000);
  });

  it("has source-provided expiry as tighter bound with null maxFetchLag", () => {
    expect(entry.freshnessPolicy.maxFetchLagMs).toBeNull();
    expect(entry.freshnessPolicy.validForMs).toBeNull();
  });

  it("has confidence weights summing to 1.0", () => {
    const w = entry.confidencePolicy.weights;
    const sum = w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});

describe("registers ecosystem_news as contextual news_evidence evidence", () => {
  const entry = getObservationKindEntry("ecosystem_news");

  it("ecosystem_news is registered", () => {
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("ecosystem_news");
  });

  it("evidence family is news_evidence", () => {
    expect(entry.evidenceFamily).toBe("news_evidence");
  });

  it("signal class is contextual", () => {
    expect(entry.signalClass).toBe("contextual");
  });

  it("stale behavior is allow_context_only", () => {
    expect(entry.freshnessPolicy.staleBehavior).toBe("allow_context_only");
  });

  it("schema version is 1", () => {
    expect(entry.schemaVersion).toBe(1);
  });

  it("only crypto-news-api is allowed as direct source ref", () => {
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["crypto-news-api"]);
  });

  it("is active", () => {
    expect(entry.active).toBe(true);
  });

  it("has 24-hour maximum observed age", () => {
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(86_400_000);
  });

  it("has source-expiry-aware freshness with null maxFetchLag", () => {
    expect(entry.freshnessPolicy.maxFetchLagMs).toBeNull();
    expect(entry.freshnessPolicy.validForMs).toBeNull();
  });

  it("has confidence weights sourceReliability 0.45, completeness 0.35, derivation 0.20, llm 0", () => {
    expect(entry.confidencePolicy.weights.sourceReliability).toBe(0.45);
    expect(entry.confidencePolicy.weights.dataCompleteness).toBe(0.35);
    expect(entry.confidencePolicy.weights.derivationConfidence).toBe(0.2);
    expect(entry.confidencePolicy.weights.llmConfidence).toBe(0);
  });

  it("has confidence weights summing to 1.0", () => {
    const w = entry.confidencePolicy.weights;
    const sum = w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});

describe("registers regulatory_risk as contextual news_evidence evidence", () => {
  const entry = getObservationKindEntry("regulatory_risk");

  it("regulatory_risk is registered", () => {
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("regulatory_risk");
  });

  it("evidence family is news_evidence", () => {
    expect(entry.evidenceFamily).toBe("news_evidence");
  });

  it("signal class is contextual", () => {
    expect(entry.signalClass).toBe("contextual");
  });

  it("stale behavior is allow_context_only", () => {
    expect(entry.freshnessPolicy.staleBehavior).toBe("allow_context_only");
  });

  it("schema version is 1", () => {
    expect(entry.schemaVersion).toBe(1);
  });

  it("only regulatory-monitor-api is allowed as direct source ref", () => {
    expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["regulatory-monitor-api"]);
  });

  it("is active", () => {
    expect(entry.active).toBe(true);
  });

  it("has 72-hour maximum observed age", () => {
    expect(entry.freshnessPolicy.maxObservedAgeMs).toBe(259_200_000);
  });

  it("has source-expiry-aware freshness with null maxFetchLag", () => {
    expect(entry.freshnessPolicy.maxFetchLagMs).toBeNull();
    expect(entry.freshnessPolicy.validForMs).toBeNull();
  });

  it("has confidence weights sourceReliability 0.45, completeness 0.35, derivation 0.20, llm 0", () => {
    expect(entry.confidencePolicy.weights.sourceReliability).toBe(0.45);
    expect(entry.confidencePolicy.weights.dataCompleteness).toBe(0.35);
    expect(entry.confidencePolicy.weights.derivationConfidence).toBe(0.2);
    expect(entry.confidencePolicy.weights.llmConfidence).toBe(0);
  });

  it("has confidence weights summing to 1.0", () => {
    const w = entry.confidencePolicy.weights;
    const sum = w.sourceReliability + w.dataCompleteness + w.derivationConfidence + w.llmConfidence;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});
