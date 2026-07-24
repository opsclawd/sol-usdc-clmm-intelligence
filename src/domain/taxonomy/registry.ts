import type {
  ObservationKind,
  ObservationKindEntry,
  FeatureKind,
  FeatureKindEntry
} from "../../contracts/taxonomy.js";

const DEFAULT_THRESHOLDS = {
  lowBelow: 0.4,
  highAtOrAbove: 0.7
} as const;

const DEFAULT_PROVENANCE_REQUIREMENTS = {
  minRawObservationRefs: 1,
  minDerivedFromRefs: 0,
  minSourceRefs: 1,
  requireProcessRef: true,
  requireCodeVersion: true,
  requireRunId: false
} as const;

export const observationKindRegistry = {
  pool_state: {
    kind: "pool_state",
    evidenceFamily: "clmm_state",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  position_state: {
    kind: "position_state",
    evidenceFamily: "clmm_state",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  oracle_price: {
    kind: "oracle_price",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.5,
        dataCompleteness: 0.3,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["pyth-hermes", "jupiter-price", "jupiter-price-v3"]
    },
    active: true,
    schemaVersion: 1
  },
  executable_quote: {
    kind: "executable_quote",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 30_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.5,
        dataCompleteness: 0.3,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["jupiter-quote"]
    },
    active: true,
    schemaVersion: 1
  },
  fee_metrics: {
    kind: "fee_metrics",
    evidenceFamily: "clmm_economics",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 300_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "degrade_confidence"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  volume_metrics: {
    kind: "volume_metrics",
    evidenceFamily: "clmm_economics",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 300_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "degrade_confidence"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  trigger_event: {
    kind: "trigger_event",
    evidenceFamily: "execution_safety",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  data_quality: {
    kind: "data_quality",
    evidenceFamily: "execution_safety",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  pool_statistics: {
    kind: "pool_statistics",
    evidenceFamily: "clmm_economics",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 300_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "degrade_confidence"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["orca-public-api"]
    },
    active: true,
    schemaVersion: 1
  },
  support_resistance_level: {
    kind: "support_resistance_level",
    evidenceFamily: "support_resistance",
    signalClass: "contextual",
    freshnessPolicy: {
      maxObservedAgeMs: 86_400_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "allow_context_only"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.45,
        dataCompleteness: 0.35,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["technical-analysis-api"]
    },
    active: true,
    schemaVersion: 1
  },
  scheduled_event: {
    kind: "scheduled_event",
    evidenceFamily: "macro_protocol_risk",
    signalClass: "contextual",
    freshnessPolicy: {
      maxObservedAgeMs: 86_400_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.45,
        dataCompleteness: 0.35,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["macro-calendar-api"]
    },
    active: true,
    schemaVersion: 1
  },
  protocol_incident: {
    kind: "protocol_incident",
    evidenceFamily: "macro_protocol_risk",
    signalClass: "contextual",
    freshnessPolicy: {
      maxObservedAgeMs: 900_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.45,
        dataCompleteness: 0.35,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["solana-status-api"]
    },
    active: true,
    schemaVersion: 1
  },
  ecosystem_news: {
    kind: "ecosystem_news",
    evidenceFamily: "news_evidence",
    signalClass: "contextual",
    freshnessPolicy: {
      maxObservedAgeMs: 86_400_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "allow_context_only"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.45,
        dataCompleteness: 0.35,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["crypto-news-api"]
    },
    active: true,
    schemaVersion: 1
  },
  regulatory_risk: {
    kind: "regulatory_risk",
    evidenceFamily: "news_evidence",
    signalClass: "contextual",
    freshnessPolicy: {
      maxObservedAgeMs: 259_200_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "allow_context_only"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.45,
        dataCompleteness: 0.35,
        derivationConfidence: 0.2,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      ...DEFAULT_PROVENANCE_REQUIREMENTS,
      allowedSourceRefs: ["regulatory-monitor-api"]
    },
    active: true,
    schemaVersion: 1
  }
} as const satisfies Record<ObservationKind, ObservationKindEntry>;

export const featureKindRegistry = {
  range_location: {
    kind: "range_location",
    evidenceFamily: "clmm_state",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  distance_to_lower: {
    kind: "distance_to_lower",
    evidenceFamily: "clmm_state",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  distance_to_upper: {
    kind: "distance_to_upper",
    evidenceFamily: "clmm_state",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.4,
        dataCompleteness: 0.3,
        derivationConfidence: 0.3,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  oracle_dex_divergence: {
    kind: "oracle_dex_divergence",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.4,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 2,
      minDerivedFromRefs: 0,
      minSourceRefs: 2,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["pyth-hermes", "jupiter-price", "jupiter-price-v3"]
    },
    active: true,
    schemaVersion: 1
  },
  oracle_confidence_width: {
    kind: "oracle_confidence_width",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "exclude"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.4,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["pyth-hermes"]
    },
    active: true,
    schemaVersion: 1
  },
  realized_volatility_1h: {
    kind: "realized_volatility_1h",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 300_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "degrade_confidence"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.4,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["pyth-hermes", "jupiter-price", "jupiter-price-v3"]
    },
    active: true,
    schemaVersion: 1
  },
  volume_liquidity_ratio_24h: {
    kind: "volume_liquidity_ratio_24h",
    evidenceFamily: "clmm_economics",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 300_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "degrade_confidence"
    },
    confidencePolicy: {
      weights: {
        sourceReliability: 0.3,
        dataCompleteness: 0.3,
        derivationConfidence: 0.4,
        llmConfidence: 0
      },
      thresholds: DEFAULT_THRESHOLDS,
      redistributeLlmWeight: true
    },
    provenanceRequirements: {
      minRawObservationRefs: 1,
      minDerivedFromRefs: 0,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle", "orca-public-api"]
    },
    active: true,
    schemaVersion: 1
  }
} as const satisfies Record<FeatureKind, FeatureKindEntry>;

export function getObservationKindEntry(kind: ObservationKind): ObservationKindEntry {
  return observationKindRegistry[kind];
}

export function getFeatureKindEntry(kind: FeatureKind): FeatureKindEntry {
  return featureKindRegistry[kind];
}
