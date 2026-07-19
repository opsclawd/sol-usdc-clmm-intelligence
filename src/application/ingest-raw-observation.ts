import type { Source, ParseStatus } from "../contracts/taxonomy.js";
import type {
  RawObservationRepo,
  RawInsertOutcome,
  RawObservationRow
} from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import type { JsonStore } from "../ports/json-store.js";

export class RawObservationConflictError extends Error {
  constructor(
    public readonly source: Source,
    public readonly sourceObservationKey: string,
    public readonly existingPayloadHash: string,
    public readonly incomingPayloadHash: string
  ) {
    super(
      `Conflict for ${source}:${sourceObservationKey}: existing hash ${existingPayloadHash} vs incoming ${incomingPayloadHash}`
    );
    this.name = "RawObservationConflictError";
  }
}

export interface IngestRawObservationDeps {
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  jsonStore: JsonStore;
}

export interface IngestRawObservationInput<TAccepted, TCandidate, TEnriched> {
  source: Source;
  sourceObservationKey: string;
  observedAtUnixMs: number;
  fetchedAtUnixMs: number;
  payloadCanonical: string;
  payloadHash: string;
  sourceRequestMeta?: unknown;
  receivedAtUnixMs: number;
  validatePayload: (canonical: string) => { accepted: TAccepted };
  buildCandidates: (accepted: TAccepted, rawRow: RawObservationRow) => TCandidate[];
  enrichCandidates: (
    candidates: TCandidate[],
    rawRow: RawObservationRow,
    runId: string | null
  ) => Promise<TEnriched[]>;
  insertNormalized: (
    enriched: TEnriched[],
    candidates: TCandidate[],
    rawRow: RawObservationRow
  ) => Promise<number>;
  writeCompatibilityOutput?: (accepted: TAccepted, rawRow: RawObservationRow) => Promise<void>;
  revalidateStoredCanonical?: (canonical: string) => { accepted: TAccepted };
}

export interface IngestRawObservationResult {
  rawObservationId: number;
  rawOutcome: RawInsertOutcome;
  normalizedCount: number;
  parseStatus: ParseStatus;
}

export async function ingestRawObservation<TAccepted, TCandidate, TEnriched>(
  deps: IngestRawObservationDeps,
  input: IngestRawObservationInput<TAccepted, TCandidate, TEnriched>
): Promise<IngestRawObservationResult> {
  const { rawObservationRepo } = deps;
  const {
    source,
    sourceObservationKey,
    observedAtUnixMs,
    fetchedAtUnixMs,
    payloadCanonical,
    payloadHash,
    sourceRequestMeta,
    receivedAtUnixMs,
    validatePayload,
    buildCandidates,
    enrichCandidates,
    insertNormalized,
    writeCompatibilityOutput,
    revalidateStoredCanonical
  } = input;

  const rawInsertResult = await rawObservationRepo.insertOrClassify({
    source,
    sourceObservationKey,
    observedAtUnixMs,
    fetchedAtUnixMs,
    payloadHash,
    payloadCanonical,
    parseStatus: "pending",
    sourceRequestMeta,
    receivedAtUnixMs
  });

  if (rawInsertResult.outcome === "conflict") {
    throw new RawObservationConflictError(
      source,
      sourceObservationKey,
      rawInsertResult.row.payloadHash,
      rawInsertResult.incomingPayloadHash
    );
  }

  if (rawInsertResult.outcome === "identical_replay") {
    const existingRow = rawInsertResult.row;

    if (existingRow.parseStatus === "parsed") {
      if (writeCompatibilityOutput) {
        const { accepted } = validatePayload(existingRow.payloadCanonical);
        await writeCompatibilityOutput(accepted, existingRow);
      }
      return {
        rawObservationId: existingRow.id,
        rawOutcome: rawInsertResult,
        normalizedCount: 0,
        parseStatus: "parsed"
      };
    }

    const revalidator = revalidateStoredCanonical ?? validatePayload;
    const { accepted } = revalidator(existingRow.payloadCanonical);
    const candidates = buildCandidates(accepted, existingRow);

    const runId: string | null = null;
    const enriched = await enrichCandidates(candidates, existingRow, runId);
    const normalizedCount = await insertNormalized(enriched, candidates, existingRow);

    const parseStatus: ParseStatus = "parsed";
    await rawObservationRepo.updateParseStatus(existingRow.id, parseStatus);

    if (writeCompatibilityOutput) {
      await writeCompatibilityOutput(accepted, existingRow);
    }

    return {
      rawObservationId: existingRow.id,
      rawOutcome: rawInsertResult,
      normalizedCount,
      parseStatus
    };
  }

  const rawRow = rawInsertResult.row;
  const { accepted } = validatePayload(payloadCanonical);
  const candidates = buildCandidates(accepted, rawRow);

  let parseStatus: ParseStatus = "pending";
  let normalizedCount = 0;

  try {
    const runId: string | null = null;
    const enriched = await enrichCandidates(candidates, rawRow, runId);
    normalizedCount = await insertNormalized(enriched, candidates, rawRow);
    parseStatus = "parsed";
  } catch (err) {
    await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
    throw err;
  }

  await rawObservationRepo.updateParseStatus(rawRow.id, parseStatus);

  if (writeCompatibilityOutput) {
    await writeCompatibilityOutput(accepted, rawRow);
  }

  return {
    rawObservationId: rawRow.id,
    rawOutcome: rawInsertResult,
    normalizedCount,
    parseStatus
  };
}
