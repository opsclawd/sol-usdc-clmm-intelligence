import type {
  ObservationKind,
  FeatureKind,
  Source,
  SignalClass,
  EvidenceFamily,
  ConfidenceLevel,
  StaleBehavior,
  ParseStatus
} from "../../contracts/taxonomy.js";

const OBSERVATION_KINDS = new Set<ObservationKind>([
  "pool_state",
  "position_state",
  "oracle_price",
  "executable_quote",
  "fee_metrics",
  "volume_metrics",
  "trigger_event",
  "data_quality",
  "pool_statistics",
  "ecosystem_news",
  "regulatory_risk",
  "support_resistance_level",
  "scheduled_event",
  "protocol_incident"
]);

const FEATURE_KINDS = new Set<FeatureKind>([
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "oracle_dex_divergence",
  "oracle_confidence_width",
  "realized_volatility_1h",
  "volume_liquidity_ratio_24h"
]);

const SOURCES = new Set<Source>([
  "clmm-v2-bundle",
  "jupiter-price",
  "jupiter-price-v3",
  "coingecko",
  "defillama",
  "pyth-hermes",
  "jupiter-quote",
  "orca-public-api",
  "crypto-news-api",
  "regulatory-monitor-api",
  "technical-analysis-api",
  "macro-calendar-api",
  "solana-status-api"
]);

const SIGNAL_CLASSES = new Set<SignalClass>(["deterministic", "probabilistic", "contextual"]);

const EVIDENCE_FAMILIES = new Set<EvidenceFamily>([
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
]);

const CONFIDENCE_LEVELS = new Set<ConfidenceLevel>(["low", "medium", "high"]);

const STALE_BEHAVIORS = new Set<StaleBehavior>([
  "exclude",
  "degrade_confidence",
  "allow_context_only"
]);

const PARSE_STATUSES = new Set<ParseStatus>(["pending", "parsed", "failed"]);

export class TaxonomyValidationError extends Error {
  constructor(
    public readonly kind: string,
    public readonly value: string
  ) {
    super(`Invalid ${kind}: "${value}"`);
    this.name = "TaxonomyValidationError";
  }
}

function parse<T extends string>(raw: string, kind: string, valid: Set<T>): T {
  if (valid.has(raw as T)) return raw as T;
  throw new TaxonomyValidationError(kind, raw);
}

export function parseObservationKind(raw: string): ObservationKind {
  return parse(raw, "ObservationKind", OBSERVATION_KINDS);
}

export function parseFeatureKind(raw: string): FeatureKind {
  return parse(raw, "FeatureKind", FEATURE_KINDS);
}

export function parseSource(raw: string): Source {
  return parse(raw, "Source", SOURCES);
}

export function parseSignalClass(raw: string): SignalClass {
  return parse(raw, "SignalClass", SIGNAL_CLASSES);
}

export function parseEvidenceFamily(raw: string): EvidenceFamily {
  return parse(raw, "EvidenceFamily", EVIDENCE_FAMILIES);
}

export function parseConfidenceLevel(raw: string): ConfidenceLevel {
  return parse(raw, "ConfidenceLevel", CONFIDENCE_LEVELS);
}

export function parseStaleBehavior(raw: string): StaleBehavior {
  return parse(raw, "StaleBehavior", STALE_BEHAVIORS);
}

export function parseParseStatus(raw: string): ParseStatus {
  return parse(raw, "ParseStatus", PARSE_STATUSES);
}
