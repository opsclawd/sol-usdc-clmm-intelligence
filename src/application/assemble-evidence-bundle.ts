import type { Clock } from "../ports/clock.js";
import type {
  DerivedFeatureRepo,
  NormalizedObservationRepo,
  RawObservationRepo,
  EvidenceBundleRepo,
  EvidenceBundleContract,
  EvidenceBundleInsert
} from "../ports/index.js";
import type { EvidenceBundleInsertOutcome } from "../ports/bundle-repo.js";
import type { BundleFeatureCandidateQuery } from "../ports/feature-repo.js";
import type {
  FeatureKind,
  DerivedFeatureRow,
  NormalizedObservationRow,
  RawObservationRow
} from "../contracts/index.js";
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
  verifyEvidenceLineage,
  type VerifyEvidenceLineageInput
} from "../domain/evidence-bundle/lineage.js";
import {
  classifyEvidenceBundleQuality,
  type EvidenceBundleQuality
} from "../domain/evidence-bundle/quality.js";
import {
  assembleEvidenceBundleCandidate,
  type AssembleEvidenceBundleInput
} from "../domain/evidence-bundle/assemble.js";
import { MVP_FEATURE_KINDS } from "../contracts/derived-feature.js";

export interface AssembleEvidenceBundleRequest {
  readonly pair: "SOL/USDC";
  readonly poolId: string;
  readonly positionId: string;
  readonly walletId: string;
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

export type AssembleEvidenceBundleSuccess =
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

export type AssembleEvidenceBundleError =
  | { readonly code: "VALIDATION_ERROR"; readonly errors: readonly unknown[] }
  | { readonly code: "LINEAGE_ERROR"; readonly message: string }
  | { readonly code: "PERSISTENCE_ERROR"; readonly message: string }
  | { readonly code: "CONTRACT_ERROR"; readonly error: EvidenceBundleContractError }
  | { readonly code: "REQUEST_VALIDATION_ERROR"; readonly message: string }
  | { readonly code: "UNSUPPORTED_SCHEMA_VERSION"; readonly schemaVersion: string };

export type AssembleEvidenceBundleResult =
  | AssembleEvidenceBundleSuccess
  | AssembleEvidenceBundleError;

export interface AssembleEvidenceBundleDeps {
  readonly clock: Clock;
  readonly featureRepo: DerivedFeatureRepo;
  readonly normalizedRepo: NormalizedObservationRepo;
  readonly rawRepo: RawObservationRepo;
  readonly bundleRepo: EvidenceBundleRepo;
  readonly contract: EvidenceBundleContract;
}

const SUPPORTED_SCHEMA_VERSION = "evidence-bundle.v1";

function validateRequest(request: AssembleEvidenceBundleRequest): void {
  if (!request.pair || request.pair !== "SOL/USDC") {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "pair must be SOL/USDC" };
  }
  if (!request.poolId) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "poolId is required" };
  }
  if (!request.positionId) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "positionId is required" };
  }
  if (!request.walletId) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "walletId is required" };
  }
  if (!request.pipelineRunId) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "pipelineRunId is required" };
  }
  if (!request.correlationId) {
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
  if (!request.codeVersion) {
    throw { code: "REQUEST_VALIDATION_ERROR", message: "codeVersion is required" };
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
      compositeScore: quality.overallConfidenceBps,
      level:
        quality.quality === "complete" ? "high" : quality.quality === "partial" ? "medium" : "low",
      weightingVersion: "v1",
      reasons: []
    },
    confidenceComposite: quality.overallConfidenceBps,
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
        jobName: "assemble-evidence-bundle",
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

export async function assembleEvidenceBundle(
  deps: AssembleEvidenceBundleDeps,
  request: AssembleEvidenceBundleRequest
): Promise<AssembleEvidenceBundleResult> {
  const clockNow = deps.clock.now();
  const receivedAtUnixMs = new Date(clockNow).getTime();
  if (Number.isNaN(receivedAtUnixMs)) {
    throw new Error(`Invalid clock.now() value: ${clockNow}`);
  }

  try {
    validateRequest(request);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return err as AssembleEvidenceBundleError;
    }
    return { code: "REQUEST_VALIDATION_ERROR", message: String(err) };
  }

  const { featureRepo, normalizedRepo, rawRepo, bundleRepo, contract } = deps;
  const {
    evaluationTimeUnixMs,
    poolId,
    positionId,
    walletId,
    acceptedCalculatorVersions,
    assemblySelectionVersion,
    codeVersion,
    gitCommit,
    environment
  } = request;

  const asOfAtOrAfterUnixMs = evaluationTimeUnixMs - 24 * 3600000;
  const asOfAtOrBeforeUnixMs = evaluationTimeUnixMs;

  let candidates: DerivedFeatureRow[];
  try {
    const query: BundleFeatureCandidateQuery = {
      featureKinds: MVP_FEATURE_KINDS,
      pair: request.pair,
      asOfAtOrAfterUnixMs,
      asOfAtOrBeforeUnixMs,
      receivedAtOrBeforeUnixMs: evaluationTimeUnixMs,
      poolId,
      positionId
    };
    candidates = await featureRepo.listBundleCandidates(query);
  } catch (err) {
    return { code: "LINEAGE_ERROR", message: `Failed to query candidates: ${err}` };
  }

  const selectionRequest: BundleSelectionRequest = {
    evaluationTimeUnixMs,
    selectionVersion: assemblySelectionVersion,
    calculatorVersions: acceptedCalculatorVersions,
    candidates,
    poolId,
    positionId
  };

  const selectionResult: BundleSelectionResult = selectEvidenceFeatureSlots(selectionRequest);
  const { slots } = selectionResult;

  const usableCount = slots.filter(
    (s) => s.outcome === "selected_available" || s.outcome === "selected_partial"
  ).length;

  if (usableCount === 0) {
    return { outcome: "no_bundle" };
  }

  const { rawObservationIds, normalizedObservationIds } = collectLineageIds(slots);

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

  const clmmRawRow = rawRows.find((row) => row.source === "clmm-v2-bundle");
  if (!clmmRawRow) {
    return { outcome: "no_bundle" };
  }
  const clmmCanonical = clmmRawRow.payloadCanonical;

  const derivedFeaturesMap = new Map<number, DerivedFeatureRow>();
  for (const candidate of candidates) {
    derivedFeaturesMap.set(candidate.id, candidate);
  }

  const lineageInput: VerifyEvidenceLineageInput = {
    request: selectionRequest,
    slots: slots.map((slot): VerifyEvidenceLineageInput["slots"][number] => {
      const base: { featureKind: FeatureKind; outcome: string } = {
        featureKind: slot.featureKind,
        outcome: slot.outcome
      };
      if ("rowId" in slot && slot.rowId !== undefined) {
        return { ...base, rowId: slot.rowId };
      }
      if ("provenance" in slot && slot.provenance !== undefined) {
        return { ...base, provenance: slot.provenance };
      }
      if ("reasons" in slot && slot.reasons !== undefined) {
        return { ...base, reasons: slot.reasons };
      }
      return base;
    }),
    rawObservations: rawMap,
    normalizedObservations: normalizedMap,
    derivedFeatures: derivedFeaturesMap,
    clmmCanonical,
    walletId,
    positionId,
    poolId
  };

  const lineageResult = verifyEvidenceLineage(lineageInput);
  if (!lineageResult.ok) {
    return { code: "LINEAGE_ERROR", message: lineageResult.error.message };
  }

  const freshUntil = evaluationTimeUnixMs + 3600000;
  const expiresAt = evaluationTimeUnixMs + 7200000;

  const qualityInput = {
    slots,
    runId: request.pipelineRunId,
    correlationId: request.correlationId,
    createdAt: request.createdAtUnixMs,
    asOf: evaluationTimeUnixMs,
    freshUntil,
    expiresAt,
    contextPresent: false,
    briefPresent: false,
    allowNoUsableFeatures: false
  };

  const quality: EvidenceBundleQuality = classifyEvidenceBundleQuality(qualityInput);

  const assembleInput: AssembleEvidenceBundleInput = {
    slots,
    quality,
    lineage: lineageResult.lineage,
    runId: request.pipelineRunId,
    correlationId: request.correlationId,
    poolId,
    positionId,
    walletId,
    createdAt: request.createdAtUnixMs,
    asOf: evaluationTimeUnixMs,
    freshUntil,
    expiresAt,
    contextPresent: false,
    briefPresent: false,
    pipelineVersion: codeVersion,
    gitCommit,
    environment
  };

  const assembledCandidate = assembleEvidenceBundleCandidate(assembleInput);

  let canonical: CanonicalEvidenceBundle;
  try {
    canonical = await contract.validateCanonicalizeAndHash(assembledCandidate);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return { code: "CONTRACT_ERROR", error: err as EvidenceBundleContractError };
    }
    return { code: "CONTRACT_ERROR", error: { code: "VALIDATION_ERROR", errors: [String(err)] } };
  }

  const bundleInsert = buildBundleInsert(
    canonical,
    quality,
    evaluationTimeUnixMs,
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
      slotCount: slots.length,
      warnings: quality.warnings.map((w) => w.message)
    };
  }

  if (insertOutcome.outcome === "identical_replay") {
    return {
      outcome: "identical_replay",
      rowId: insertOutcome.row.id,
      payloadHash: insertOutcome.row.payloadHash,
      slotCount: slots.length,
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
