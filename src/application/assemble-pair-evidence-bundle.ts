import type { Clock } from "../ports/clock.js";
import type {
  DerivedFeatureRepo,
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  EvidenceBundleContract,
  EvidenceBundleInsert,
  NormalizedObservationCandidateQuery,
  NormalizedObservationRow,
  RawObservationRow
} from "../ports/index.js";
import type { EvidenceBundleInsertOutcome, EvidenceBundleRow } from "../ports/bundle-repo.js";
import type { BundleFeatureCandidateQuery } from "../ports/feature-repo.js";
import type { FeatureKind, DerivedFeatureRow } from "../contracts/index.js";
import type {
  EvidenceBundleContractError,
  CanonicalEvidenceBundle
} from "../ports/evidence-bundle-contract.js";
import {
  selectEvidenceFeatureSlots,
  type BundleSelectionRequest,
  type BundleSelectionResult,
  type SelectedFeatureSlot
} from "../domain/evidence-bundle/select.js";
import {
  verifyPairEvidenceLineage,
  type VerifiedEvidenceLineage
} from "../domain/evidence-bundle/lineage.js";
import {
  classifyEvidenceBundleQuality,
  type EvidenceBundleQuality
} from "../domain/evidence-bundle/quality.js";
import {
  assembleEvidenceBundleCandidate,
  type AssembleEvidenceBundleInput
} from "../domain/evidence-bundle/assemble.js";
import { hasUsableDerivativeSlots } from "../domain/evidence-bundle/derivatives.js";
import { MVP_FEATURE_KINDS } from "../contracts/derived-feature.js";
import {
  selectCurrentContextEvents,
  type SelectedContextEvent
} from "../domain/context-events/select.js";
import {
  selectSupportResistanceClaims,
  type SelectedSupportResistance
} from "../domain/support-resistance/select.js";
import { selectNewsEvidence, type SelectedNewsEvidence } from "../domain/news-events/select.js";
import { confidenceBpsToFraction } from "../domain/evidence-bundle/confidence-bps.js";
import { buildPairRunId } from "./core-evidence-pipeline-policy.js";
import type { EvidenceBundleV1 } from "../contracts/generated/evidence-bundle-v1.js";
import type { PersistedResearchBrief } from "../contracts/research-brief.js";
import { mapPersistedBriefToCanonicalBundle } from "../domain/brief/map-to-evidence-bundle.js";

export interface AssemblePairEvidenceBundleRequest {
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly pipelineRunId: string;
  readonly correlationId: string;
  readonly evaluationTimeUnixMs: number;
  readonly createdAtUnixMs: number;
  readonly acceptedCalculatorVersions: Readonly<Record<FeatureKind, string>>;
  readonly schemaVersion: string;
  readonly assemblySelectionVersion: string;
  readonly codeVersion: string;
  readonly gitCommit: string;
  readonly environment: "production" | "staging" | "development" | "test";
}

export type AssemblePairEvidenceBundleSuccess =
  | {
      readonly outcome: "persisted";
      readonly rowId: number;
      readonly payloadHash: string;
      readonly slotCount: number;
      readonly warnings: readonly string[];
    }
  | {
      readonly outcome: "identical_replay";
      readonly rowId: number;
      readonly payloadHash: string;
      readonly slotCount: number;
      readonly warnings: readonly string[];
    }
  | { readonly outcome: "conflict"; readonly rowId: number; readonly incomingPayloadHash: string }
  | { readonly outcome: "no_bundle" };

export type AssemblePairEvidenceBundleError =
  | { readonly code: "VALIDATION_ERROR"; readonly errors: readonly unknown[] }
  | { readonly code: "LINEAGE_ERROR"; readonly message: string }
  | { readonly code: "PERSISTENCE_ERROR"; readonly message: string }
  | { readonly code: "CONTRACT_ERROR"; readonly error: EvidenceBundleContractError }
  | { readonly code: "REQUEST_VALIDATION_ERROR"; readonly message: string }
  | { readonly code: "UNSUPPORTED_SCHEMA_VERSION"; readonly schemaVersion: string };

export type AssemblePairEvidenceBundleResult =
  | AssemblePairEvidenceBundleSuccess
  | AssemblePairEvidenceBundleError;

export interface PreparedPairEvidenceBundle {
  readonly slots: readonly SelectedFeatureSlot[];
  readonly lineage: VerifiedEvidenceLineage["lineage"];
  readonly selectedContextEvents: readonly SelectedContextEvent[];
  readonly selectedSupportResistance: readonly SelectedSupportResistance[];
  readonly selectedNewsEvidence: readonly SelectedNewsEvidence[];
  readonly qualityInputFacts: {
    readonly createdAt: number;
    readonly asOf: number;
    readonly freshUntil: number;
    readonly expiresAt: number;
    readonly hasSupportResistance: boolean;
    readonly hasFlows: boolean;
    readonly hasDerivatives: boolean;
    readonly hasEvents: boolean;
    readonly hasNewsRegulatory: boolean;
  };
  readonly requestMeta: {
    readonly pair: "SOL/USDC";
    readonly poolId: string;
    readonly pipelineRunId: string;
    readonly correlationId: string;
    readonly evaluationTimeUnixMs: number;
    readonly createdAtUnixMs: number;
    readonly codeVersion: string;
    readonly gitCommit: string;
    readonly environment: "production" | "staging" | "development" | "test";
  };
  readonly nullBriefCandidate: EvidenceBundleV1;
  readonly canonical: CanonicalEvidenceBundle;
}

export type PreparePairEvidenceBundleSuccess =
  | {
      readonly outcome: "prepared";
      readonly prepared: PreparedPairEvidenceBundle;
    }
  | {
      readonly outcome: "identical_replay";
      readonly rowId: number;
      readonly payloadHash: string;
      readonly slotCount: number;
      readonly warnings: readonly string[];
    }
  | { readonly outcome: "conflict"; readonly rowId: number; readonly incomingPayloadHash: string }
  | { readonly outcome: "no_bundle" };

export type PreparePairEvidenceBundleResult =
  | PreparePairEvidenceBundleSuccess
  | AssemblePairEvidenceBundleError;

export interface AssemblePairEvidenceBundleDeps {
  readonly clock: Clock;
  readonly featureRepo: DerivedFeatureRepo;
  readonly normalizedRepo: NormalizedObservationRepo;
  readonly rawRepo: RawObservationRepo;
  readonly bundleRepo: EvidenceBundleRepo;
  readonly contract: EvidenceBundleContract;
}

const SUPPORTED_SCHEMA_VERSION = "evidence-bundle.v1";

const POSITION_SCOPED_FEATURE_KINDS = new Set<FeatureKind>([
  "range_location",
  "distance_to_lower",
  "distance_to_upper"
]);

const PAIR_FEATURE_KINDS = MVP_FEATURE_KINDS.filter(
  (kind) => !POSITION_SCOPED_FEATURE_KINDS.has(kind)
);

function validateRequest(request: AssemblePairEvidenceBundleRequest): void {
  if (!request.pair || request.pair !== "SOL/USDC") {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "pair must be SOL/USDC" };
  }
  if (!request.poolId || !request.poolId.trim()) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "poolId is required" };
  }
  if (!request.pipelineRunId || !request.pipelineRunId.trim()) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "pipelineRunId is required" };
  }
  if (!request.correlationId || !request.correlationId.trim()) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "correlationId is required" };
  }
  if (typeof request.evaluationTimeUnixMs !== "number" || request.evaluationTimeUnixMs < 0) {
    throw {
      code: "REQUEST_VALIDATION_ERROR",
      message: "evaluationTimeUnixMs must be a non-negative number"
    };
  }
  if (typeof request.createdAtUnixMs !== "number" || request.createdAtUnixMs < 0) {
    throw {
      code: "REQUEST_VALIDATION_ERROR",
      message: "createdAtUnixMs must be a non-negative number"
    };
  }
  if (
    !request.acceptedCalculatorVersions ||
    typeof request.acceptedCalculatorVersions !== "object"
  ) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "acceptedCalculatorVersions is required" };
  }
  for (const kind of MVP_FEATURE_KINDS) {
    if (!request.acceptedCalculatorVersions[kind]) {
      throw {
        code: "REQUEST_VALIDATION_ERROR",
        message: `acceptedCalculatorVersions must include ${kind}`
      };
    }
  }
  if (!request.schemaVersion) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "schemaVersion is required" };
  }
  if (request.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw { code: "UNSUPPORTED_SCHEMA_VERSION", schemaVersion: request.schemaVersion };
  }
  if (!request.assemblySelectionVersion) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "assemblySelectionVersion is required" };
  }
  if (!request.codeVersion || !request.codeVersion.trim()) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "codeVersion is required" };
  }
  if (!request.gitCommit || !request.gitCommit.trim()) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "gitCommit is required" };
  }
  if (!request.environment) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "environment is required" };
  }
}

function buildBundleInsert(
  canonical: CanonicalEvidenceBundle,
  quality: EvidenceBundleQuality,
  asOfUnixMs: number,
  receivedAtUnixMs: number
): EvidenceBundleInsert {
  const expiresAtUnixMs = asOfUnixMs + 3600000;
  const validUntilUnixMs = quality.expiresAt;
  const compositeScore = confidenceBpsToFraction(quality.overallConfidenceBps);

  return {
    schemaVersion: canonical.schemaVersion,
    pair: "SOL/USDC",
    asOfUnixMs,
    expiresAtUnixMs,
    payload: canonical.payload,
    payloadHash: canonical.payloadHash,
    payloadCanonical: canonical.payloadCanonical,
    idempotencyKey: canonical.idempotencyKey,
    taxonomySummary: null,
    dominantSignalClass: "deterministic",
    confidence: {
      components: {
        sourceReliability: 1,
        dataCompleteness: 1,
        derivationConfidence: 1,
        llmConfidence: null
      },
      compositeScore,
      level:
        quality.quality === "complete" ? "high" : quality.quality === "partial" ? "medium" : "low",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: compositeScore,
    confidenceLevel:
      quality.quality === "complete" ? "high" : quality.quality === "partial" ? "medium" : "low",

    validUntilUnixMs,
    isStale: false,
    staleBehavior: null,
    provenance: {
      sourceRefs: [],
      rawObservationRefs: [],
      derivedFromRefs: [],
      processRef: {
        collector: "evidence-bundle-assembly",
        jobName: "assemble-pair-evidence-bundle",
        pipelineRunId: null,
        codeVersion: null,
        modelVersion: null
      },
      codeVersion: "1.0.0",
      runId: null
    },
    version: 1,
    receivedAtUnixMs
  };
}

function collectLineageIds(slots: readonly SelectedFeatureSlot[]): {
  rawObservationIds: Set<number>;
  normalizedObservationIds: Set<number>;
} {
  const rawObservationIds = new Set<number>();
  const normalizedObservationIds = new Set<number>();

  for (const slot of slots) {
    if (
      slot.outcome === "missing" ||
      slot.outcome === "expired_only" ||
      slot.outcome === "unsupported_version_only"
    ) {
      continue;
    }

    const provenance = slot.provenance;
    if (!provenance) continue;

    for (const ref of provenance.rawObservationRefs) {
      if (ref.refType === "normalized_observation") {
        normalizedObservationIds.add(ref.id);
      } else if (ref.refType === "raw_observation") {
        rawObservationIds.add(ref.id);
      }
    }
  }

  return { rawObservationIds, normalizedObservationIds };
}

export async function preparePairEvidenceBundle(
  deps: AssemblePairEvidenceBundleDeps,
  request: AssemblePairEvidenceBundleRequest
): Promise<PreparePairEvidenceBundleResult> {
  try {
    validateRequest(request);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return err as AssemblePairEvidenceBundleError;
    }
    return { code: "REQUEST_VALIDATION_ERROR", message: String(err) };
  }

  const { featureRepo, normalizedRepo, rawRepo, bundleRepo, contract } = deps;
  const { evaluationTimeUnixMs, codeVersion, gitCommit, environment } = request;

  const asOfAtOrAfterUnixMs = evaluationTimeUnixMs - 24 * 3600000;
  const asOfAtOrBeforeUnixMs = evaluationTimeUnixMs;

  let candidates: DerivedFeatureRow[];
  try {
    const query: BundleFeatureCandidateQuery = {
      featureKinds: PAIR_FEATURE_KINDS,
      pair: request.pair,
      asOfAtOrAfterUnixMs,
      asOfAtOrBeforeUnixMs,
      receivedAtOrBeforeUnixMs: evaluationTimeUnixMs,
      poolId: request.poolId,
      positionId: null
    };
    candidates = await featureRepo.listBundleCandidates(query);
  } catch (err) {
    return { code: "LINEAGE_ERROR", message: `Failed to query candidates: ${err}` };
  }

  const selectionRequest: BundleSelectionRequest = {
    evaluationTimeUnixMs,
    selectionVersion: request.assemblySelectionVersion,
    calculatorVersions: request.acceptedCalculatorVersions,
    candidates,
    featureKinds: PAIR_FEATURE_KINDS,
    poolId: request.poolId,
    positionId: undefined
  };

  const selectionResult: BundleSelectionResult = selectEvidenceFeatureSlots(selectionRequest);
  const { slots } = selectionResult;

  const usableCount = slots.filter(
    (slot) => slot.outcome === "selected_available" || slot.outcome === "selected_partial"
  ).length;

  if (usableCount === 0) {
    return { outcome: "no_bundle" };
  }

  const contextualCandidateQuery: NormalizedObservationCandidateQuery = {
    sourceKinds: [
      { source: "macro-calendar-api", observationKind: "scheduled_event" },
      { source: "solana-status-api", observationKind: "protocol_incident" },
      { source: "helius-api", observationKind: "whale_transfer" },
      { source: "helius-api", observationKind: "whale_swap" },
      { source: "birdeye-api", observationKind: "whale_swap" },
      { source: "helius-api", observationKind: "stablecoin_flow" },
      { source: "helius-api", observationKind: "cex_flow_proxy" },
      { source: "birdeye-api", observationKind: "dex_net_flow" },
      { source: "technical-analysis-api", observationKind: "support_resistance_level" },
      { source: "crypto-news-api", observationKind: "ecosystem_news" },
      { source: "regulatory-monitor-api", observationKind: "regulatory_risk" }
    ],
    receivedAtOrAfterUnixMs: evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000
  };

  let contextualCandidates: NormalizedObservationRow[] = [];
  let selectedContextEvents: readonly SelectedContextEvent[] = [];
  let selectedSupportResistance: readonly SelectedSupportResistance[] = [];
  let selectedNewsEvidence: readonly SelectedNewsEvidence[] = [];

  try {
    contextualCandidates = await normalizedRepo.listCandidates(contextualCandidateQuery);
    selectedContextEvents = selectCurrentContextEvents({
      evaluationTimeUnixMs,
      candidates: contextualCandidates,
      maxItems: 64
    });
    selectedSupportResistance = selectSupportResistanceClaims({
      evaluationTimeUnixMs,
      candidates: contextualCandidates,
      maxItems: 16
    });
    selectedNewsEvidence = selectNewsEvidence({
      evaluationTimeUnixMs,
      candidates: contextualCandidates,
      maxItems: 16
    });
  } catch (err) {
    return { code: "LINEAGE_ERROR", message: `Failed to query contextual candidates: ${err}` };
  }

  const selectedContextualRows: NormalizedObservationRow[] = [
    ...selectedContextEvents.map((e) => e.row),
    ...selectedSupportResistance.map((sr) => sr.row),
    ...selectedNewsEvidence.map((ne) => ne.row)
  ];

  const { rawObservationIds, normalizedObservationIds } = collectLineageIds(slots);

  for (const row of selectedContextualRows) {
    normalizedObservationIds.add(row.id);
    rawObservationIds.add(row.rawObservationId);
  }

  const normalizedIdArray = [...normalizedObservationIds];
  let normalizedRows: NormalizedObservationRow[] = [];
  if (normalizedIdArray.length > 0) {
    try {
      normalizedRows = await normalizedRepo.findByIds(normalizedIdArray);
    } catch (err) {
      return { code: "LINEAGE_ERROR", message: `Failed to load normalized observations: ${err}` };
    }
  }

  for (const normRow of normalizedRows) {
    rawObservationIds.add(normRow.rawObservationId);
  }

  const rawIdArray = [...rawObservationIds];
  let rawRows: RawObservationRow[] = [];
  if (rawIdArray.length > 0) {
    try {
      rawRows = await rawRepo.findByIds(rawIdArray);
    } catch (err) {
      return { code: "LINEAGE_ERROR", message: `Failed to load raw observations: ${err}` };
    }
  }

  const normalizedMap = new Map<number, NormalizedObservationRow>();
  for (const row of normalizedRows) {
    normalizedMap.set(row.id, row);
  }

  const rawMap = new Map<number, RawObservationRow>();
  for (const row of rawRows) {
    rawMap.set(row.id, row);
  }

  const lineageResult = verifyPairEvidenceLineage({
    slots,
    normalizedObservations: normalizedMap,
    rawObservations: rawMap,
    contextualObservations: selectedContextualRows
  });

  if (!lineageResult.ok) {
    return { code: "LINEAGE_ERROR", message: lineageResult.error.message };
  }

  const freshUntil = evaluationTimeUnixMs + 3600000;
  const expiresAt = evaluationTimeUnixMs + 7200000;
  const hasSupportResistance = selectedSupportResistance.length > 0;
  const hasFlows = selectedContextEvents.some((item) => item.eventFamily === "on_chain_flow");
  const hasDerivatives = hasUsableDerivativeSlots(slots);
  const hasEvents = selectedContextEvents.some((item) => item.eventFamily !== "on_chain_flow");
  const hasNewsRegulatory = selectedNewsEvidence.length > 0;

  const qualityInputFacts = {
    createdAt: request.createdAtUnixMs,
    asOf: evaluationTimeUnixMs,
    freshUntil,
    expiresAt,
    hasSupportResistance,
    hasFlows,
    hasDerivatives,
    hasEvents,
    hasNewsRegulatory
  };

  const qualityInput = {
    slots,
    featureKinds: PAIR_FEATURE_KINDS,
    runId: request.pipelineRunId,
    correlationId: request.correlationId,
    createdAt: request.createdAtUnixMs,
    asOf: evaluationTimeUnixMs,
    freshUntil,
    expiresAt,
    hasSupportResistance,
    hasFlows,
    hasDerivatives,
    hasEvents,
    hasNewsRegulatory,
    hasResearchBrief: false,
    allowNoUsableFeatures: false
  };

  const quality: EvidenceBundleQuality = classifyEvidenceBundleQuality(qualityInput);

  const runId = buildPairRunId(request.pipelineRunId);

  const assembleInput: AssembleEvidenceBundleInput = {
    slots,
    featureKinds: PAIR_FEATURE_KINDS,
    quality,
    lineage: lineageResult.lineage,
    runId,
    correlationId: request.correlationId,
    scope: { kind: "pair" },
    createdAt: request.createdAtUnixMs,
    asOf: evaluationTimeUnixMs,
    freshUntil,
    expiresAt,
    briefPresent: false,
    pipelineVersion: codeVersion,
    gitCommit,
    environment,
    contextualEvents: selectedContextEvents,
    selectedSupportResistance,
    selectedNewsEvidence
  };

  const nullBriefCandidate = assembleEvidenceBundleCandidate(assembleInput);

  let canonical: CanonicalEvidenceBundle;
  try {
    canonical = await contract.validateCanonicalizeAndHash(nullBriefCandidate);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return { code: "CONTRACT_ERROR", error: err as EvidenceBundleContractError };
    }
    return { code: "CONTRACT_ERROR", error: { code: "VALIDATION_ERROR", errors: [String(err)] } };
  }

  let existingRows: EvidenceBundleRow[] = [];
  try {
    existingRows = (await bundleRepo.findByPair(request.pair, evaluationTimeUnixMs)) ?? [];
  } catch (err) {
    // If bundleRepo lookup throws, proceed
  }

  const matchingRow = (existingRows ?? []).find(
    (row) => row.idempotencyKey === canonical.idempotencyKey
  );

  if (matchingRow) {
    const payloadObj = matchingRow.payload as EvidenceBundleV1 | undefined | null;
    const hasEmbeddedBrief =
      payloadObj !== null &&
      typeof payloadObj === "object" &&
      "researchBrief" in payloadObj &&
      payloadObj.researchBrief !== null &&
      payloadObj.researchBrief !== undefined;

    if (hasEmbeddedBrief) {
      const warnings =
        payloadObj &&
        typeof payloadObj === "object" &&
        "assessment" in payloadObj &&
        payloadObj.assessment &&
        Array.isArray(payloadObj.assessment.warnings)
          ? payloadObj.assessment.warnings.map((w: { message: string }) => w.message)
          : [];
      return {
        outcome: "identical_replay",
        rowId: matchingRow.id,
        payloadHash: matchingRow.payloadHash,
        slotCount: slots.length,
        warnings
      };
    } else {
      return {
        outcome: "conflict",
        rowId: matchingRow.id,
        incomingPayloadHash: canonical.payloadHash
      };
    }
  }

  const prepared: PreparedPairEvidenceBundle = {
    slots,
    lineage: lineageResult.lineage,
    selectedContextEvents,
    selectedSupportResistance,
    selectedNewsEvidence,
    qualityInputFacts,
    requestMeta: {
      pair: request.pair,
      poolId: request.poolId,
      pipelineRunId: request.pipelineRunId,
      correlationId: request.correlationId,
      evaluationTimeUnixMs: request.evaluationTimeUnixMs,
      createdAtUnixMs: request.createdAtUnixMs,
      codeVersion: request.codeVersion,
      gitCommit: request.gitCommit,
      environment: request.environment
    },
    nullBriefCandidate,
    canonical
  };

  return {
    outcome: "prepared",
    prepared
  };
}

export async function finalizePairEvidenceBundle(
  deps: AssemblePairEvidenceBundleDeps,
  prepared: PreparedPairEvidenceBundle,
  researchBrief?: PersistedResearchBrief
): Promise<AssemblePairEvidenceBundleResult> {
  const clockNow = deps.clock.now();
  const receivedAtUnixMs = new Date(clockNow).getTime();
  if (Number.isNaN(receivedAtUnixMs)) {
    throw new Error(`Invalid clock.now() value: ${clockNow}`);
  }

  const { bundleRepo, contract } = deps;
  const hasResearchBrief = researchBrief !== undefined;

  const qualityInput = {
    slots: prepared.slots,
    featureKinds: PAIR_FEATURE_KINDS,
    runId: prepared.requestMeta.pipelineRunId,
    correlationId: prepared.requestMeta.correlationId,
    createdAt: prepared.qualityInputFacts.createdAt,
    asOf: prepared.qualityInputFacts.asOf,
    freshUntil: prepared.qualityInputFacts.freshUntil,
    expiresAt: prepared.qualityInputFacts.expiresAt,
    hasSupportResistance: prepared.qualityInputFacts.hasSupportResistance,
    hasFlows: prepared.qualityInputFacts.hasFlows,
    hasDerivatives: prepared.qualityInputFacts.hasDerivatives,
    hasEvents: prepared.qualityInputFacts.hasEvents,
    hasNewsRegulatory: prepared.qualityInputFacts.hasNewsRegulatory,
    hasResearchBrief,
    allowNoUsableFeatures: false
  };

  const quality: EvidenceBundleQuality = classifyEvidenceBundleQuality(qualityInput);

  let canonical: CanonicalEvidenceBundle;
  if (researchBrief !== undefined) {
    let finalCandidate: EvidenceBundleV1;
    try {
      finalCandidate = mapPersistedBriefToCanonicalBundle(
        prepared.nullBriefCandidate,
        researchBrief,
        researchBrief.briefId
      );
      finalCandidate.assessment.overallConfidenceBps = quality.overallConfidenceBps;
      finalCandidate.assessment.quality = quality.quality;
    } catch (err) {
      return { code: "CONTRACT_ERROR", error: { code: "VALIDATION_ERROR", errors: [String(err)] } };
    }

    try {
      canonical = await contract.validateCanonicalizeAndHash(finalCandidate);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err) {
        return { code: "CONTRACT_ERROR", error: err as EvidenceBundleContractError };
      }
      return { code: "CONTRACT_ERROR", error: { code: "VALIDATION_ERROR", errors: [String(err)] } };
    }
  } else {
    canonical = prepared.canonical;
  }

  const bundleInsert = buildBundleInsert(
    canonical,
    quality,
    prepared.qualityInputFacts.asOf,
    receivedAtUnixMs
  );

  let insertOutcome: EvidenceBundleInsertOutcome;
  try {
    insertOutcome = await bundleRepo.insertOrClassify(bundleInsert);
  } catch (err) {
    return { code: "PERSISTENCE_ERROR", message: `Bundle persistence failed: ${err}` };
  }

  if (insertOutcome.outcome === "inserted") {
    return {
      outcome: "persisted",
      rowId: insertOutcome.row.id,
      payloadHash: insertOutcome.row.payloadHash,
      slotCount: prepared.slots.length,
      warnings: quality.warnings.map((w) => w.message)
    };
  }

  if (insertOutcome.outcome === "identical_replay") {
    return {
      outcome: "identical_replay",
      rowId: insertOutcome.row.id,
      payloadHash: insertOutcome.row.payloadHash,
      slotCount: prepared.slots.length,
      warnings: quality.warnings.map((w) => w.message)
    };
  }

  if (insertOutcome.outcome === "conflict") {
    return {
      outcome: "conflict",
      rowId: insertOutcome.row.id,
      incomingPayloadHash: insertOutcome.incomingPayloadHash
    };
  }

  return { outcome: "no_bundle" };
}

export async function assemblePairEvidenceBundle(
  deps: AssemblePairEvidenceBundleDeps,
  request: AssemblePairEvidenceBundleRequest
): Promise<AssemblePairEvidenceBundleResult> {
  const preparedResult = await preparePairEvidenceBundle(deps, request);
  if ("code" in preparedResult) {
    return preparedResult;
  }
  if (preparedResult.outcome !== "prepared") {
    return preparedResult;
  }
  return finalizePairEvidenceBundle(deps, preparedResult.prepared, undefined);
}
