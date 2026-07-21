import type {
  EvidenceBundleRepo,
  EvidenceBundleRow,
  EvidenceBundleInsert,
  EvidenceBundleInsertOutcome
} from "../../src/ports/bundle-repo.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";

interface IdentityKey {
  schemaVersion: string;
  pair: string;
  idempotencyKey: string;
}

export class FakeBundleRepo implements EvidenceBundleRepo {
  readonly store: EvidenceBundleRow[] = [];
  readonly deletedIdentityKeys: Set<string> = new Set();
  private nextId = 1;

  private identityKeyString(key: IdentityKey): string {
    return `${key.schemaVersion}:${key.pair}:${key.idempotencyKey}`;
  }

  async insertOrClassify(row: EvidenceBundleInsert): Promise<EvidenceBundleInsertOutcome> {
    const parsedPayload = JSON.parse(JSON.stringify(row.payload));
    const parsedCanonical = JSON.parse(row.payloadCanonical);
    if (JSON.stringify(parsedPayload) !== JSON.stringify(parsedCanonical)) {
      throw new Error(
        `Canonical text does not match payload: canonical=${row.payloadCanonical}, payload=${JSON.stringify(row.payload)}`
      );
    }

    const identityKey: IdentityKey = {
      schemaVersion: row.schemaVersion,
      pair: row.pair,
      idempotencyKey: row.idempotencyKey
    };
    const identityStr = this.identityKeyString(identityKey);

    if (this.deletedIdentityKeys.has(identityStr)) {
      throw new Error(
        "Evidence bundle row was deleted after conflict classification - integrity violation"
      );
    }

    const existing = this.store.find(
      (r) =>
        r.schemaVersion === row.schemaVersion &&
        r.pair === row.pair &&
        r.idempotencyKey === row.idempotencyKey
    );

    if (existing) {
      if (
        existing.payloadHash === row.payloadHash &&
        existing.payloadCanonical === row.payloadCanonical
      ) {
        return { outcome: "identical_replay", row: existing };
      }
      return {
        outcome: "conflict",
        row: existing,
        incomingPayloadHash: row.payloadHash
      };
    }

    const result: EvidenceBundleRow = {
      id: this.nextId++,
      schemaVersion: row.schemaVersion,
      pair: row.pair,
      asOfUnixMs: row.asOfUnixMs,
      expiresAtUnixMs: row.expiresAtUnixMs,
      payload: row.payload,
      payloadHash: row.payloadHash,
      payloadCanonical: row.payloadCanonical,
      idempotencyKey: row.idempotencyKey,
      taxonomySummary: row.taxonomySummary ?? null,
      dominantSignalClass: row.dominantSignalClass ?? "deterministic",
      confidence: row.confidence ?? DEFAULT_CONFIDENCE,
      confidenceComposite: row.confidenceComposite ?? null,
      confidenceLevel: row.confidenceLevel ?? null,
      validUntilUnixMs: row.validUntilUnixMs ?? null,
      isStale: row.isStale ?? false,
      staleBehavior: row.staleBehavior ?? null,
      provenance: row.provenance ?? DEFAULT_PROVENANCE,
      version: row.version ?? 1,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(result);
    return { outcome: "inserted", row: result };
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.store.filter((r) => r.pair === pair && r.asOfUnixMs >= sinceUnixMs);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const matching = this.store.filter((r) => r.pair === pair);
    if (matching.length === 0) return undefined;
    return matching.reduce((a, b) => (a.receivedAtUnixMs > b.receivedAtUnixMs ? a : b));
  }
}
