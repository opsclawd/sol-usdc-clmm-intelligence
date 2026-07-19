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
  buildCandidates: (accepted: TAccepted, rawRow: RawObservationRow) => readonly TCandidate[];
  enrichCandidates: (
    candidates: readonly TCandidate[],
    rawRow: RawObservationRow,
    runId: string | null
  ) => Promise<readonly TEnriched[]>;
  insertNormalized: (
    enriched: readonly TEnriched[],
    candidates: readonly TCandidate[],
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
        const revalidator = revalidateStoredCanonical ?? validatePayload;
        const { accepted } = revalidator(existingRow.payloadCanonical);
        await writeCompatibilityOutput(accepted, existingRow);
      }
      return {
        rawObservationId: existingRow.id,
        rawOutcome: rawInsertResult,
        normalizedCount: 0,
        parseStatus: "parsed"
      };
    }

    let replayParseStatus: ParseStatus = "pending";
    try {
      const revalidator = revalidateStoredCanonical ?? validatePayload;
      const { accepted } = revalidator(existingRow.payloadCanonical);
      const candidates = buildCandidates(accepted, existingRow);

      const runId: string | null = null;
      const enriched = await enrichCandidates(candidates, existingRow, runId);
      const normalizedCount = await insertNormalized(enriched, candidates, existingRow);

      replayParseStatus = "parsed";
      await rawObservationRepo.updateParseStatus(existingRow.id, replayParseStatus);

      if (writeCompatibilityOutput) {
        await writeCompatibilityOutput(accepted, existingRow);
      }

      return {
        rawObservationId: existingRow.id,
        rawOutcome: rawInsertResult,
        normalizedCount,
        parseStatus: replayParseStatus
      };
    } catch (err) {
      try {
        await rawObservationRepo.updateParseStatus(existingRow.id, "failed");
      } catch {
        // Ignore status update failure - original error takes precedence
      }
      throw err;
    }
  }

  const rawRow = rawInsertResult.row;
  let parseStatus: ParseStatus = "pending";
  let normalizedCount = 0;
  let accepted: TAccepted | undefined;

  try {
    const result = validatePayload(payloadCanonical);
    accepted = result.accepted;
    const candidates = buildCandidates(accepted, rawRow);
    const runId: string | null = null;
    const enriched = await enrichCandidates(candidates, rawRow, runId);
    normalizedCount = await insertNormalized(enriched, candidates, rawRow);
    parseStatus = "parsed";
  } catch (err) {
    try {
      await rawObservationRepo.updateParseStatus(rawRow.id, "failed");
    } catch {
      // Ignore status update failure - original error takes precedence
    }
    throw err;
  }

  await rawObservationRepo.updateParseStatus(rawRow.id, parseStatus);

  if (writeCompatibilityOutput && accepted !== undefined) {
    await writeCompatibilityOutput(accepted, rawRow);
  }

  return {
    rawObservationId: rawRow.id,
    rawOutcome: rawInsertResult,
    normalizedCount,
    parseStatus
  };
}
