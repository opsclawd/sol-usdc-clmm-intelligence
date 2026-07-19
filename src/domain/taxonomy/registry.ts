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
  }
} as const satisfies Record<ObservationKind, ObservationKindEntry>;

export const featureKindRegistry = {
  fee_apr: {
    kind: "fee_apr",
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
      minDerivedFromRefs: 1,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle"]
    },
    active: true,
    schemaVersion: 1
  },
  oracle_divergence: {
    kind: "oracle_divergence",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 60_000,
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
      minRawObservationRefs: 2,
      minDerivedFromRefs: 0,
      minSourceRefs: 2,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["pyth-hermes", "jupiter-quote", "jupiter-price-v3", "coingecko"]
    },
    active: true,
    schemaVersion: 1
  },
  volatility_24h: {
    kind: "volatility_24h",
    evidenceFamily: "price_quality",
    signalClass: "deterministic",
    freshnessPolicy: {
      maxObservedAgeMs: 600_000,
      maxFetchLagMs: null,
      validForMs: null,
      clockSkewToleranceMs: 5_000,
      staleBehavior: "allow_context_only"
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
      allowedSourceRefs: ["coingecko", "defillama"]
    },
    active: true,
    schemaVersion: 1
  },
  liquidity_depth: {
    kind: "liquidity_depth",
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
      minDerivedFromRefs: 1,
      minSourceRefs: 1,
      requireProcessRef: true,
      requireCodeVersion: true,
      requireRunId: false,
      allowedSourceRefs: ["clmm-v2-bundle"]
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
