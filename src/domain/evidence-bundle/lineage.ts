import type {
  FeatureKind,
  ProvenanceRef,
  Source,
  DerivedFeatureRow,
  NormalizedObservationRow,
  RawObservationRow
} from "../../contracts/index.js";
import { acceptClmmBundle } from "../clmm-bundle/validate.js";
import type { BundleSelectionRequest } from "./select.js";

export type LineageVerificationErrorCode =
  | "MISSING_NORMALIZED_REFERENCE"
  | "MISSING_RAW_PARENT"
  | "PROVENANCE_ID_MISMATCH"
  | "PROVENANCE_SOURCE_MISMATCH"
  | "PROVENANCE_HASH_MISMATCH"
  | "WALLET_MISMATCH"
  | "POSITION_MISMATCH"
  | "POOL_MISMATCH"
  | "PAIR_MISMATCH"
  | "INVALID_CLMM_PAYLOAD"
  | "UNSUPPORTED_CONTEXTUAL_KIND";

export interface LineageVerificationError {
  readonly code: LineageVerificationErrorCode;
  readonly message: string;
  readonly context?: unknown;
}

export type VerifyEvidenceLineageInput = {
  readonly request: BundleSelectionRequest;
  readonly slots: ReadonlyArray<{
    readonly featureKind: FeatureKind;
    readonly outcome: string;
    readonly rowId?: number;
    readonly provenance?: {
      readonly sourceRefs: readonly ProvenanceRef[];
      readonly rawObservationRefs: readonly ProvenanceRef[];
      readonly derivedFromRefs: readonly ProvenanceRef[];
      readonly processRef: {
        readonly collector: string;
        readonly jobName: string;
        readonly pipelineRunId: string | null;
        readonly codeVersion: string | null;
        readonly modelVersion: string | null;
      };
      readonly codeVersion: string;
      readonly runId: string | null;
    };
    readonly reasons?: readonly string[];
  }>;
  readonly rawObservations: ReadonlyMap<number, RawObservationRow>;
  readonly normalizedObservations: ReadonlyMap<number, NormalizedObservationRow>;
  readonly derivedFeatures: ReadonlyMap<number, DerivedFeatureRow>;
  readonly clmmCanonical: string;
  readonly walletId: string;
  readonly positionId: string;
  readonly poolId: string;
  readonly contextualObservations?: readonly NormalizedObservationRow[];
};

export interface VerifiedLineageSourceRef {
  readonly referenceId: string;
  readonly sourceType: "api" | "database" | "chain" | "document" | "internal_bundle";
  readonly locator: string;
  readonly observedAt: string;
}

export interface VerifiedEvidenceLineage {
  readonly lineage: {
    readonly rawObservationIds: readonly number[];
    readonly normalizedObservationIds: readonly number[];
    readonly sourceReferences: readonly VerifiedLineageSourceRef[];
  };
}

function validateClmmCanonical(
  clmmCanonical: string
): { ok: true; bundle: unknown } | { ok: false; error: LineageVerificationError } {
  try {
    const parsed = JSON.parse(clmmCanonical);
    try {
      const bundle = acceptClmmBundle(parsed);
      return { ok: true, bundle };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "INVALID_CLMM_PAYLOAD",
          message: e instanceof Error ? e.message : "CLMM bundle validation failed",
          context: e
        }
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_CLMM_PAYLOAD",
        message: "CLMM canonical is not valid JSON"
      }
    };
  }
}

function verifyScopeConsistency(
  bundle: unknown,
  walletId: string,
  positionId: string,
  poolId: string
): { ok: true } | { ok: false; error: LineageVerificationError } {
  const b = bundle as {
    pair: string;
    pool: { poolId: string };
    positions: Array<{ walletId: string; positionId: string; poolId: string }>;
  };

  if (b.pair !== "SOL/USDC") {
    return {
      ok: false,
      error: { code: "PAIR_MISMATCH", message: `Expected SOL/USDC, got ${b.pair}` }
    };
  }

  if (b.pool.poolId !== poolId) {
    return {
      ok: false,
      error: { code: "POOL_MISMATCH", message: `Expected pool ${poolId}, got ${b.pool.poolId}` }
    };
  }

  const position = b.positions.find((p) => p.positionId === positionId);
  if (!position) {
    return {
      ok: false,
      error: { code: "POSITION_MISMATCH", message: `Position ${positionId} not found in bundle` }
    };
  }

  if (position.walletId !== walletId) {
    return {
      ok: false,
      error: {
        code: "WALLET_MISMATCH",
        message: `Expected wallet ${walletId}, got ${position.walletId}`
      }
    };
  }

  if (position.poolId !== poolId) {
    return {
      ok: false,
      error: {
        code: "POOL_MISMATCH",
        message: `Position pool mismatch: expected ${poolId}, got ${position.poolId}`
      }
    };
  }

  return { ok: true };
}

function verifyProvenanceRef(
  ref: ProvenanceRef,
  normalizedObservations: ReadonlyMap<number, NormalizedObservationRow>,
  rawObservations: ReadonlyMap<number, RawObservationRow>
):
  | { ok: true; normalizedRow?: NormalizedObservationRow; rawRow?: RawObservationRow }
  | { ok: false; error: LineageVerificationError } {
  if (ref.refType === "normalized_observation") {
    const row = normalizedObservations.get(ref.id);
    if (!row) {
      return {
        ok: false,
        error: {
          code: "MISSING_NORMALIZED_REFERENCE",
          message: `Normalized observation ${ref.id} not found`
        }
      };
    }
    if (row.id !== ref.id) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_ID_MISMATCH",
          message: `Normalized observation id mismatch: expected ${ref.id}, got ${row.id}`
        }
      };
    }
    if (row.source !== ref.source) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_SOURCE_MISMATCH",
          message: `Normalized observation source mismatch: expected ${ref.source}, got ${row.source}`
        }
      };
    }
    if (row.payloadHash !== ref.payloadHash) {
      return {
        ok: false,
        error: { code: "PROVENANCE_HASH_MISMATCH", message: `Normalized observation hash mismatch` }
      };
    }
    const rawRow = rawObservations.get(row.rawObservationId);
    if (!rawRow) {
      return {
        ok: false,
        error: {
          code: "MISSING_RAW_PARENT",
          message: `Raw observation ${row.rawObservationId} not found for normalized ${ref.id}`
        }
      };
    }
    return { ok: true, normalizedRow: row, rawRow };
  }

  if (ref.refType === "raw_observation") {
    const row = rawObservations.get(ref.id);
    if (!row) {
      return {
        ok: false,
        error: { code: "MISSING_RAW_PARENT", message: `Raw observation ${ref.id} not found` }
      };
    }
    if (row.id !== ref.id) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_ID_MISMATCH",
          message: `Raw observation id mismatch: expected ${ref.id}, got ${row.id}`
        }
      };
    }
    if (row.source !== ref.source) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_SOURCE_MISMATCH",
          message: `Raw observation source mismatch: expected ${ref.source}, got ${row.source}`
        }
      };
    }
    if (row.payloadHash !== ref.payloadHash) {
      return {
        ok: false,
        error: { code: "PROVENANCE_HASH_MISMATCH", message: `Raw observation hash mismatch` }
      };
    }
    return { ok: true, rawRow: row };
  }

  return { ok: true };
}

function sourceToSourceType(source: Source): VerifiedLineageSourceRef["sourceType"] {
  switch (source) {
    case "clmm-v2-bundle":
      return "chain";
    case "jupiter-price":
    case "jupiter-price-v3":
    case "jupiter-quote":
    case "coingecko":
    case "defillama":
    case "pyth-hermes":
    case "orca-public-api":
    case "macro-calendar-api":
    case "solana-status-api":
    case "technical-analysis-api":
      return "api";
    default:
      return "internal_bundle";
  }
}

function collectLineage(
  slots: VerifyEvidenceLineageInput["slots"],
  normalizedObservations: ReadonlyMap<number, NormalizedObservationRow>,
  rawObservations: ReadonlyMap<number, RawObservationRow>
): {
  rawObservationIds: Set<number>;
  normalizedObservationIds: Set<number>;
  sourceReferences: VerifiedLineageSourceRef[];
} {
  const rawObservationIds = new Set<number>();
  const normalizedObservationIds = new Set<number>();
  const sourceReferences: VerifiedLineageSourceRef[] = [];

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
        const normRow = normalizedObservations.get(ref.id);
        if (normRow) {
          rawObservationIds.add(normRow.rawObservationId);
          const rawRow = rawObservations.get(normRow.rawObservationId);
          if (rawRow) {
            sourceReferences.push({
              referenceId: `raw-${rawRow.id}`,
              sourceType: sourceToSourceType(rawRow.source),
              locator: rawRow.sourceObservationKey,
              observedAt: String(rawRow.observedAtUnixMs)
            });
          }
        }
      } else if (ref.refType === "raw_observation") {
        rawObservationIds.add(ref.id);
        const rawRow = rawObservations.get(ref.id);
        if (rawRow) {
          sourceReferences.push({
            referenceId: `raw-${rawRow.id}`,
            sourceType: sourceToSourceType(rawRow.source),
            locator: rawRow.sourceObservationKey,
            observedAt: String(rawRow.observedAtUnixMs)
          });
        }
      }
    }
  }

  return { rawObservationIds, normalizedObservationIds, sourceReferences };
}

export function verifyEvidenceLineage(
  input: VerifyEvidenceLineageInput
):
  | { ok: true; lineage: VerifiedEvidenceLineage["lineage"] }
  | { ok: false; error: LineageVerificationError } {
  const {
    slots,
    rawObservations,
    normalizedObservations,
    clmmCanonical,
    walletId,
    positionId,
    poolId,
    contextualObservations = []
  } = input;

  const clmmResult = validateClmmCanonical(clmmCanonical);
  if (!clmmResult.ok) {
    return clmmResult;
  }

  const scopeResult = verifyScopeConsistency(clmmResult.bundle, walletId, positionId, poolId);
  if (!scopeResult.ok) {
    return scopeResult;
  }

  const selectedSlots = slots.filter(
    (s) =>
      s.outcome === "selected_available" ||
      s.outcome === "selected_partial" ||
      s.outcome === "selected_unavailable"
  );

  for (const slot of selectedSlots) {
    const provenance = slot.provenance;
    if (!provenance) continue;

    for (const ref of provenance.rawObservationRefs) {
      const refResult = verifyProvenanceRef(ref, normalizedObservations, rawObservations);
      if (!refResult.ok) {
        return refResult;
      }

      if (refResult.normalizedRow && refResult.rawRow) {
        const rawRefResult = verifyProvenanceRef(
          {
            refType: "raw_observation",
            id: refResult.rawRow.id,
            source: refResult.rawRow.source,
            payloadHash: refResult.rawRow.payloadHash
          },
          normalizedObservations,
          rawObservations
        );
        if (!rawRefResult.ok) {
          return rawRefResult;
        }
      }
    }
  }

  for (const ctxRow of contextualObservations) {
    if (
      ctxRow.observationKind !== "scheduled_event" &&
      ctxRow.observationKind !== "protocol_incident"
    ) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_CONTEXTUAL_KIND",
          message: `Contextual observation kind '${ctxRow.observationKind}' is not supported. Only scheduled_event and protocol_incident are allowed.`
        }
      };
    }

    const rawRow = rawObservations.get(ctxRow.rawObservationId);
    if (!rawRow) {
      return {
        ok: false,
        error: {
          code: "MISSING_RAW_PARENT",
          message: `Raw observation ${ctxRow.rawObservationId} not found for contextual normalized ${ctxRow.id}`
        }
      };
    }

    if (rawRow.source !== ctxRow.source) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_SOURCE_MISMATCH",
          message: `Contextual observation source mismatch: expected ${rawRow.source}, got ${ctxRow.source}`
        }
      };
    }

    const ref = ctxRow.provenance.rawObservationRefs.find(
      (r) => r.refType === "raw_observation" && r.id === rawRow.id
    );
    const expectedHash = ref?.payloadHash ?? rawRow.payloadHash;

    if (rawRow.payloadHash !== expectedHash) {
      return {
        ok: false,
        error: {
          code: "PROVENANCE_HASH_MISMATCH",
          message: `Contextual observation hash mismatch for normalized ${ctxRow.id}`
        }
      };
    }

    const rawRefResult = verifyProvenanceRef(
      {
        refType: "raw_observation",
        id: rawRow.id,
        source: rawRow.source,
        payloadHash: rawRow.payloadHash
      },
      normalizedObservations,
      rawObservations
    );
    if (!rawRefResult.ok) {
      return rawRefResult;
    }
  }

  const { rawObservationIds, normalizedObservationIds, sourceReferences } = collectLineage(
    slots,
    normalizedObservations,
    rawObservations
  );

  for (const ctxRow of contextualObservations) {
    rawObservationIds.add(ctxRow.rawObservationId);
    normalizedObservationIds.add(ctxRow.id);
    const rawRow = rawObservations.get(ctxRow.rawObservationId);
    if (rawRow) {
      sourceReferences.push({
        referenceId: `raw-${rawRow.id}`,
        sourceType: sourceToSourceType(rawRow.source),
        locator: rawRow.sourceObservationKey,
        observedAt: String(rawRow.observedAtUnixMs)
      });
    }
  }

  const sortedRawIds = [...rawObservationIds].sort((a, b) => a - b);
  const sortedNormIds = [...normalizedObservationIds].sort((a, b) => a - b);

  return {
    ok: true,
    lineage: {
      rawObservationIds: sortedRawIds,
      normalizedObservationIds: sortedNormIds,
      sourceReferences
    }
  };
}
