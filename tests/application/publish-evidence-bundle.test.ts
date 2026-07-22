import { describe, expect, it, beforeEach } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import type { HttpClient, HttpResponse } from "../../src/ports/http.js";
import { HttpRequestError } from "../../src/ports/http.js";
import type { EnvReader } from "../../src/ports/env.js";
import type { EvidenceBundleRepo, EvidenceBundleRow } from "../../src/ports/bundle-repo.js";
import type {
  PublishAttemptRepo,
  PublishAttemptRow,
  PublishAttemptInsert
} from "../../src/ports/publish-attempt-repo.js";
import type {
  EvidenceBundleContract,
  CanonicalEvidenceBundle
} from "../../src/ports/evidence-bundle-contract.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type {
  PublishEvidenceBundleResult,
  PublishEvidenceBundleEvent
} from "../../src/application/publish-evidence-bundle.js";
import { DEFAULT_CONFIDENCE, DEFAULT_PROVENANCE } from "../helpers/taxonomy-fixtures.js";
import { FakeRetry } from "../fakes/fake-retry.js";

const EPOCH = "2024-01-01T00:00:00.000Z";
const EVAL_MS = new Date(EPOCH).getTime();

const DEFAULT_PAYLOAD: EvidenceBundleV1 = {
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  source: { publisher: "sol-usdc-clmm-intelligence", sourceId: "src-1", sourceVersion: "v1" },
  runId: "run-123",
  correlationId: "corr-123",
  createdAt: EPOCH,
  asOf: EPOCH,
  freshUntil: EPOCH,
  expiresAt: EPOCH,
  deterministicFeatures: [
    {
      featureId: "feat-1",
      family: "market_state",
      featureKind: "number",
      status: "unavailable",
      value: null,
      unit: null,
      observedAt: null,
      freshUntil: null,
      confidenceBps: 0,
      calculator: { name: "test-calc", version: "v1" },
      inputLineage: ["input-1"],
      warnings: ["warn-1"]
    }
  ],
  contextualEvidence: {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  },
  researchBrief: null,
  sourceReferences: [
    {
      referenceId: "ref-1",
      sourceType: "internal_bundle",
      locator: "internal://test",
      observedAt: EPOCH
    }
  ],
  assessment: {
    overallConfidenceBps: 100,
    quality: "complete",
    coverage: {
      deterministic: "available",
      supportResistance: "not_applicable",
      flows: "not_applicable",
      derivatives: "not_applicable",
      events: "not_applicable",
      newsRegulatory: "not_applicable",
      researchBrief: "not_applicable"
    },
    warnings: []
  },
  provenance: {
    pipelineVersion: "v1",
    gitCommit: "abc123",
    environment: "test",
    upstreamRunIds: []
  }
};

function buildCanonicalFromPayload(payload: unknown): CanonicalEvidenceBundle {
  const payloadCanonical = JSON.stringify(payload);
  return {
    payload: payload as EvidenceBundleV1,
    payloadCanonical,
    payloadHash: `hash-${payloadCanonical.length}`,
    idempotencyKey: "test-idempotency-key",
    schemaVersion: "evidence-bundle.v1"
  };
}

class RecordingClock implements Clock {
  constructor(private value: string) {}
  now(): string {
    return this.value;
  }
}

class FakeHttp implements HttpClient {
  nextResponse: HttpResponse<unknown> | null = null;
  nextError: Error | null = null;
  callLog: {
    url: string;
    body: unknown;
    options: { headers?: Record<string, string>; timeoutMs?: number; maxAttempts?: number };
  }[] = [];

  async postJsonRaw<T>(
    url: string,
    body: unknown,
    options?: { headers?: Record<string, string>; timeoutMs?: number; maxAttempts?: number }
  ): Promise<HttpResponse<T>> {
    this.callLog.push({ url, body, options: { ...options } });
    if (this.nextError) {
      throw this.nextError;
    }
    if (!this.nextResponse) {
      throw new Error("No response configured");
    }
    return this.nextResponse as HttpResponse<T>;
  }

  async getJson<T>(): Promise<T> {
    throw new Error("Not implemented");
  }
}

class FakeEnvReader implements EnvReader {
  store: Record<string, string> = {};
  get(name: string, fallback?: string): string {
    return this.store[name] ?? fallback ?? "";
  }
  getOptional(name: string): string | undefined {
    return this.store[name];
  }
}

class FakeBundleRepo implements EvidenceBundleRepo {
  store: EvidenceBundleRow[] = [];
  private nextId = 1;

  async insertOrClassify(): Promise<
    | { outcome: "inserted"; row: EvidenceBundleRow }
    | { outcome: "identical_replay"; row: EvidenceBundleRow }
    | { outcome: "conflict"; row: EvidenceBundleRow; incomingPayloadHash: string }
  > {
    throw new Error("Not implemented");
  }

  async findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]> {
    return this.store.filter((r) => r.pair === pair && r.asOfUnixMs >= sinceUnixMs);
  }

  async findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined> {
    const matches = this.store.filter((r) => r.pair === pair);
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
  }
}

class FakePublishAttemptRepo implements PublishAttemptRepo {
  store: PublishAttemptRow[] = [];
  private nextId = 1;
  insertShouldFail = false;
  insertConflict = false;

  async insert(
    row: PublishAttemptInsert
  ): Promise<
    | { outcome: "inserted"; row: PublishAttemptRow }
    | { outcome: "conflict"; row: PublishAttemptRow }
  > {
    if (this.insertShouldFail) {
      throw new Error("Insert failed");
    }
    if (this.insertConflict) {
      const existing: PublishAttemptRow = {
        id: 999,
        target: row.target,
        targetEndpoint: row.targetEndpoint,
        evidenceBundleId: row.evidenceBundleId,
        researchBriefId: row.researchBriefId ?? null,
        idempotencyKey: row.idempotencyKey,
        requestHash: row.requestHash,
        payloadHash: row.payloadHash,
        status: row.status,
        httpStatus: row.httpStatus ?? null,
        responseBody: row.responseBody ?? null,
        errorCode: row.errorCode ?? null,
        errorMessage: row.errorMessage ?? null,
        attemptNumber: row.attemptNumber,
        firstAttemptedAtUnixMs: row.firstAttemptedAtUnixMs,
        completedAtUnixMs: row.completedAtUnixMs ?? null,
        receivedAtUnixMs: row.receivedAtUnixMs
      };
      return { outcome: "conflict", row: existing };
    }
    const newRow: PublishAttemptRow = {
      id: this.nextId++,
      target: row.target,
      targetEndpoint: row.targetEndpoint,
      evidenceBundleId: row.evidenceBundleId,
      researchBriefId: row.researchBriefId ?? null,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      payloadHash: row.payloadHash,
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      responseBody: row.responseBody ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      attemptNumber: row.attemptNumber,
      firstAttemptedAtUnixMs: row.firstAttemptedAtUnixMs,
      completedAtUnixMs: row.completedAtUnixMs ?? null,
      receivedAtUnixMs: row.receivedAtUnixMs
    };
    this.store.push(newRow);
    return { outcome: "inserted", row: newRow };
  }

  async findByTargetAndKey(target: string, idempotencyKey: string): Promise<PublishAttemptRow[]> {
    return this.store.filter((r) => r.target === target && r.idempotencyKey === idempotencyKey);
  }

  async findByBundle(evidenceBundleId: number): Promise<PublishAttemptRow[]> {
    return this.store.filter((r) => r.evidenceBundleId === evidenceBundleId);
  }

  async findRecentByStatus(
    status: string,
    sinceUnixMs: number,
    limit: number
  ): Promise<PublishAttemptRow[]> {
    return this.store
      .filter((r) => r.status === status && r.receivedAtUnixMs >= sinceUnixMs)
      .slice(0, limit);
  }
}

interface FakeContract extends EvidenceBundleContract {
  validateShouldFail: boolean;
  validateError: unknown;
  overrideResult?: CanonicalEvidenceBundle;
}

function createFakeContract(): FakeContract {
  return {
    validateShouldFail: false,
    validateError: null,
    async validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle> {
      if (this.validateShouldFail) {
        throw this.validateError ?? new Error("Contract validation failed");
      }
      if (this.overrideResult) {
        return this.overrideResult;
      }
      return buildCanonicalFromPayload(candidate as EvidenceBundleV1);
    }
  };
}

function makeBundleRow(
  overrides: Partial<EvidenceBundleRow> & { payload?: EvidenceBundleV1; idempotencyKey?: string }
): EvidenceBundleRow {
  const payload: EvidenceBundleV1 = overrides.payload ?? { ...DEFAULT_PAYLOAD };
  const canonical = buildCanonicalFromPayload(payload);
  return {
    id: overrides.id ?? 1,
    schemaVersion: overrides.schemaVersion ?? "evidence-bundle.v1",
    pair: overrides.pair ?? "SOL/USDC",
    asOfUnixMs: overrides.asOfUnixMs ?? EVAL_MS,
    expiresAtUnixMs: overrides.expiresAtUnixMs ?? EVAL_MS + 7200000,
    payload: payload as unknown,
    payloadHash: canonical.payloadHash,
    payloadCanonical: canonical.payloadCanonical,
    idempotencyKey: overrides.idempotencyKey ?? canonical.idempotencyKey,
    taxonomySummary: null,
    dominantSignalClass: "deterministic",
    confidence: DEFAULT_CONFIDENCE,
    confidenceComposite: 100,
    confidenceLevel: "high",
    validUntilUnixMs: EVAL_MS + 3600000,
    isStale: false,
    staleBehavior: null,
    provenance: DEFAULT_PROVENANCE,
    version: 1,
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? EVAL_MS - 60000
  };
}

describe("publishEvidenceBundle", () => {
  let clock: RecordingClock;
  let http: FakeHttp;
  let env: FakeEnvReader;
  let bundleRepo: FakeBundleRepo;
  let publishAttemptRepo: FakePublishAttemptRepo;
  let contract: FakeContract;
  let retry: FakeRetry;

  beforeEach(() => {
    clock = new RecordingClock(EPOCH);
    http = new FakeHttp();
    env = new FakeEnvReader();
    bundleRepo = new FakeBundleRepo();
    publishAttemptRepo = new FakePublishAttemptRepo();
    contract = createFakeContract();
    retry = new FakeRetry([]);

    env.store = {
      REGIME_ENGINE_BASE_URL: "https://regime-engine.example.com",
      REGIME_ENGINE_AUTH_TOKEN: "test-token-abc123"
    };
  });

  async function publish(): Promise<{
    result: PublishEvidenceBundleResult;
    events: PublishEvidenceBundleEvent[];
  }> {
    const { publishEvidenceBundle } =
      await import("../../src/application/publish-evidence-bundle.js");
    const events: PublishEvidenceBundleEvent[] = [];
    const result = await publishEvidenceBundle(
      { clock, http, env, bundleRepo, publishAttemptRepo, contract, retry },
      { onEvent: (e) => events.push(e) }
    );
    return { result, events };
  }

  describe("local invalid never sends and audits validation_failed", () => {
    it("no HTTP call is made when bundle row has unsupported schema version", async () => {
      bundleRepo.store.push(makeBundleRow({ schemaVersion: "unsupported-version" }));
      await publish();
      expect(http.callLog).toHaveLength(0);
    });

    it("no HTTP call is made when contract validation fails", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.validateShouldFail = true;
      contract.validateError = { code: "VALIDATION_ERROR", errors: ["test error"] };
      await publish();
      expect(http.callLog).toHaveLength(0);
    });

    it("validation_failed audit row is inserted for malformed row", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.validateShouldFail = true;
      contract.validateError = { code: "VALIDATION_ERROR", errors: ["test error"] };
      await publish();
      expect(publishAttemptRepo.store).toHaveLength(1);
      expect(publishAttemptRepo.store[0]!.status).toBe("validation_failed");
      expect(publishAttemptRepo.store[0]!.attemptNumber).toBe(1);
    });

    it("bundle_not_found is returned when no bundle exists", async () => {
      const { result } = await publish();
      expect(result.outcome).toBe("bundle_not_found");
      expect(http.callLog).toHaveLength(0);
    });
  });

  describe("exact persisted payload and identity are sent unchanged", () => {
    it("HTTP request uses bundle.payload directly", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 200, ok: true, body: { success: true }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
      expect(http.callLog[0]!.body).toBe(bundle.payload);
    });

    it("HTTP request uses stored idempotency key", async () => {
      const bundle = makeBundleRow({ idempotencyKey: "my-custom-key" });
      bundleRepo.store.push(bundle);
      const canonical = buildCanonicalFromPayload(bundle.payload);
      contract.overrideResult = { ...canonical, idempotencyKey: "my-custom-key" };
      http.nextResponse = { status: 200, ok: true, body: { success: true }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
      expect(http.callLog[0]!.options.headers?.["Idempotency-Key"]).toBe("my-custom-key");
    });

    it("Authorization header contains Bearer token", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 200, ok: true, body: { success: true }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
      expect(http.callLog[0]!.options.headers?.["Authorization"]).toBe("Bearer test-token-abc123");
    });

    it("requestHash equals payloadHash from bundle", async () => {
      const bundlePayload = { ...DEFAULT_PAYLOAD };
      const customHash = "my-verified-hash";
      const bundle: EvidenceBundleRow = {
        id: 1,
        schemaVersion: "evidence-bundle.v1",
        pair: "SOL/USDC",
        asOfUnixMs: EVAL_MS,
        expiresAtUnixMs: EVAL_MS + 7200000,
        payload: bundlePayload,
        payloadHash: customHash,
        payloadCanonical: JSON.stringify(bundlePayload),
        idempotencyKey: "test-idempotency-key",
        taxonomySummary: null,
        dominantSignalClass: "deterministic",
        confidence: DEFAULT_CONFIDENCE,
        confidenceComposite: 100,
        confidenceLevel: "high",
        validUntilUnixMs: EVAL_MS + 3600000,
        isStale: false,
        staleBehavior: null,
        provenance: DEFAULT_PROVENANCE,
        version: 1,
        receivedAtUnixMs: EVAL_MS - 60000
      };
      bundleRepo.store.push(bundle);
      contract.overrideResult = {
        payload: bundlePayload,
        payloadCanonical: JSON.stringify(bundlePayload),
        payloadHash: customHash,
        idempotencyKey: "test-idempotency-key",
        schemaVersion: "evidence-bundle.v1"
      };
      http.nextResponse = { status: 200, ok: true, body: { success: true }, headers: {} };
      await publish();
      expect(publishAttemptRepo.store[0]!.requestHash).toBe("my-verified-hash");
      expect(publishAttemptRepo.store[0]!.payloadHash).toBe("my-verified-hash");
    });
  });

  describe("201 audits created and terminates", () => {
    it("201 maps to created outcome", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("created");
    });

    it("201 inserts one completed audit row", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(publishAttemptRepo.store).toHaveLength(1);
      expect(publishAttemptRepo.store[0]!.status).toBe("created");
      expect(publishAttemptRepo.store[0]!.httpStatus).toBe(201);
    });

    it("no second HTTP call is made after 201", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("200 audits idempotent replay and terminates", () => {
    it("200 maps to idempotent_replay outcome", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 200, ok: true, body: { id: "existing-456" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("idempotent_replay");
    });

    it("200 inserts one completed audit row", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 200, ok: true, body: { id: "existing-456" }, headers: {} };
      await publish();
      expect(publishAttemptRepo.store).toHaveLength(1);
      expect(publishAttemptRepo.store[0]!.status).toBe("idempotent_replay");
      expect(publishAttemptRepo.store[0]!.httpStatus).toBe(200);
    });

    it("no second HTTP call is made after 200", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 200, ok: true, body: { id: "existing-456" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("400 and 422 audit validation_failed without retry", () => {
    it("400 maps to validation_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 400, ok: false, body: { error: "bad request" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("validation_failed");
    });

    it("422 maps to validation_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 422, ok: false, body: { error: "unprocessable" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("validation_failed");
    });

    it("only one HTTP call is made for 400", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 400, ok: false, body: { error: "bad request" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });

    it("only one HTTP call is made for 422", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 422, ok: false, body: { error: "unprocessable" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("401 and 403 audit auth_failed without retry", () => {
    it("401 maps to auth_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 401, ok: false, body: { error: "unauthorized" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("auth_failed");
    });

    it("403 maps to auth_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 403, ok: false, body: { error: "forbidden" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("auth_failed");
    });

    it("only one HTTP call is made for 401", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 401, ok: false, body: { error: "unauthorized" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });

    it("only one HTTP call is made for 403", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 403, ok: false, body: { error: "forbidden" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("409 audits conflict without retry", () => {
    it("409 maps to conflict outcome", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 409, ok: false, body: { error: "conflict" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("conflict");
    });

    it("only one HTTP call is made for 409", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 409, ok: false, body: { error: "conflict" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("other permanent 4xx audit unknown_failed without retry", () => {
    it("418 maps to unknown_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 418, ok: false, body: { error: "I'm a teapot" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("unknown_failed");
    });

    it("499 maps to unknown_failed", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 499, ok: false, body: { error: "client closed" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("unknown_failed");
    });

    it("only one HTTP call is made for other 4xx", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 418, ok: false, body: { error: "I'm a teapot" }, headers: {} };
      await publish();
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("audit insert completes before terminal outcome is returned", () => {
    it("result is not returned until audit is persisted", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      const { result } = await publish();
      expect(publishAttemptRepo.store).toHaveLength(1);
      expect(result.outcome).toBe("created");
    });

    it("if audit insert fails, audit_store_failed is returned", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      publishAttemptRepo.insertShouldFail = true;
      const { result } = await publish();
      expect(result.outcome).toBe("audit_store_failed");
    });

    it("HTTP success is not claimed when audit insert fails", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      publishAttemptRepo.insertShouldFail = true;
      const { result } = await publish();
      expect(result.outcome).toBe("audit_store_failed");
      expect(http.callLog).toHaveLength(1);
    });
  });

  describe("deterministic-only null-brief fixture publishes unchanged", () => {
    it("bundle with null researchBrief publishes successfully", async () => {
      const bundle = makeBundleRow({});
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      bundleRepo.store.push(bundle);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("created");
      expect(http.callLog[0]!.body).toBe(bundle.payload);
    });

    it("bundle with empty deterministicFeatures publishes successfully", async () => {
      const payload = {
        ...DEFAULT_PAYLOAD,
        deterministicFeatures: [] as unknown as typeof DEFAULT_PAYLOAD.deterministicFeatures
      };
      const bundle = makeBundleRow({ payload });
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      bundleRepo.store.push(bundle);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      const { result } = await publish();
      expect(result.outcome).toBe("created");
    });
  });

  describe("response secrets are redacted before audit persistence", () => {
    it("authorization header value is redacted in response body", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = {
        status: 200,
        ok: true,
        body: { token: "secret-abc", authorization: "Bearer secret" },
        headers: { authorization: "Bearer secret" }
      };
      await publish();
      const storedResponse = publishAttemptRepo.store[0]!.responseBody as Record<string, unknown>;
      expect(storedResponse?.token).toBe("[REDACTED]");
      expect(storedResponse?.authorization).toBe("[REDACTED]");
    });

    it("api_key field is redacted in response body", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = {
        status: 200,
        ok: true,
        body: { api_key: "my-secret-key", "api-key": "another-key" },
        headers: {}
      };
      await publish();
      const storedResponse = publishAttemptRepo.store[0]!.responseBody as Record<string, unknown>;
      expect(storedResponse?.api_key).toBe("[REDACTED]");
      expect(storedResponse?.["api-key"]).toBe("[REDACTED]");
    });

    it("nested secret values are redacted", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = {
        status: 200,
        ok: true,
        body: { data: { secret: "nested-secret" } },
        headers: {}
      };
      await publish();
      const storedResponse = publishAttemptRepo.store[0]!.responseBody as Record<string, unknown>;
      expect((storedResponse?.data as Record<string, unknown>)?.secret).toBe("[REDACTED]");
    });

    it("bearer token never appears in result or audit", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = {
        status: 201,
        ok: true,
        body: { id: "new-123" },
        headers: {}
      };
      await publish();
      const resultStr = JSON.stringify(publishAttemptRepo.store[0]);
      expect(resultStr).not.toContain("test-token-abc123");
    });
  });

  describe("URL validation", () => {
    it("rejects URL with credentials", async () => {
      env.store.REGIME_ENGINE_BASE_URL = "https://user:pass@regime-engine.example.com";
      bundleRepo.store.push(makeBundleRow({}));
      const { result } = await publish();
      expect(result.outcome).toBe("local_validation_failed");
    });

    it("rejects non-HTTP protocol", async () => {
      env.store.REGIME_ENGINE_BASE_URL = "ftp://regime-engine.example.com";
      bundleRepo.store.push(makeBundleRow({}));
      const { result } = await publish();
      expect(result.outcome).toBe("local_validation_failed");
    });

    it("normalizes trailing slash", async () => {
      env.store.REGIME_ENGINE_BASE_URL = "https://regime-engine.example.com/";
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog[0]!.url).toBe("https://regime-engine.example.com/v1/evidence/sol-usdc");
    });
  });

  describe("auth token validation", () => {
    it("rejects missing auth token", async () => {
      env.store.REGIME_ENGINE_AUTH_TOKEN = "";
      bundleRepo.store.push(makeBundleRow({}));
      const { result } = await publish();
      expect(result.outcome).toBe("local_validation_failed");
      expect("reason" in result && result.reason).toBe("REGIME_ENGINE_AUTH_TOKEN is not set");
    });

    it("rejects undefined auth token", async () => {
      delete env.store.REGIME_ENGINE_AUTH_TOKEN;
      bundleRepo.store.push(makeBundleRow({}));
      const { result } = await publish();
      expect(result.outcome).toBe("local_validation_failed");
      expect("reason" in result && result.reason).toBe("REGIME_ENGINE_AUTH_TOKEN is not set");
    });

    it("no HTTP call is made when auth token is missing", async () => {
      env.store.REGIME_ENGINE_AUTH_TOKEN = "";
      bundleRepo.store.push(makeBundleRow({}));
      await publish();
      expect(http.callLog).toHaveLength(0);
    });
  });

  describe("timeout and maxAttempts", () => {
    it("uses 5000ms timeout", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog[0]!.options.timeoutMs).toBe(5000);
    });

    it("uses maxAttempts: 1", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog[0]!.options.maxAttempts).toBe(1);
    });
  });

  describe("transient failures retry at most three total attempts", () => {
    it("network error retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog.length).toBe(3);
    });

    it("timeout error retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("timeout", "Request timed out", null, true);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      await publish();
      expect(http.callLog.length).toBe(3);
    });

    it("408 status retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      let callCount = 0;
      const originalPostJsonRaw = http.postJsonRaw.bind(http);
      (http as unknown as Record<string, unknown>).postJsonRaw = async (
        ...args: Parameters<typeof originalPostJsonRaw>
      ) => {
        await originalPostJsonRaw(...args);
        callCount++;
        if (callCount < 3) {
          return { status: 408, ok: false, body: {}, headers: {} } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      const { result } = await publish();
      expect(http.callLog.length).toBe(3);
      expect(result.outcome).toBe("created");
    });

    it("429 status retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      let callCount = 0;
      const originalPostJsonRaw = http.postJsonRaw.bind(http);
      (http as unknown as Record<string, unknown>).postJsonRaw = async (
        ...args: Parameters<typeof originalPostJsonRaw>
      ) => {
        await originalPostJsonRaw(...args);
        callCount++;
        if (callCount < 3) {
          return { status: 429, ok: false, body: {}, headers: {} } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      const { result } = await publish();
      expect(http.callLog.length).toBe(3);
      expect(result.outcome).toBe("created");
    });

    it("500 status retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      let callCount = 0;
      const originalPostJsonRaw = http.postJsonRaw.bind(http);
      (http as unknown as Record<string, unknown>).postJsonRaw = async (
        ...args: Parameters<typeof originalPostJsonRaw>
      ) => {
        await originalPostJsonRaw(...args);
        callCount++;
        if (callCount < 3) {
          return { status: 500, ok: false, body: {}, headers: {} } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      const { result } = await publish();
      expect(http.callLog.length).toBe(3);
      expect(result.outcome).toBe("created");
    });

    it("503 status retries up to three times", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async (
        url: string,
        body: unknown,
        options?: { headers?: Record<string, string>; timeoutMs?: number; maxAttempts?: number }
      ) => {
        http.callLog.push({ url, body, options: options ?? {} });
        callCount++;
        if (callCount < 3) {
          return { status: 503, ok: false, body: {}, headers: {} } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      const { result } = await publish();
      expect(http.callLog.length).toBe(3);
      expect(result.outcome).toBe("created");
    });

    it("returns transient_failure_exhausted after three failed attempts", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      const { result } = await publish();
      expect(result.outcome).toBe("transient_failure_exhausted");
    });
  });

  describe("unknown outcome retries reuse exact key hash and payload", () => {
    it("same idempotency key is sent on all retry attempts", async () => {
      const bundle = makeBundleRow({ idempotencyKey: "unique-key-123" });
      bundleRepo.store.push(bundle);
      const canonical = buildCanonicalFromPayload(bundle.payload);
      contract.overrideResult = { ...canonical, idempotencyKey: "unique-key-123" };
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      await publish();
      expect(http.callLog.length).toBe(3);
      for (const call of http.callLog) {
        expect(call.options.headers?.["Idempotency-Key"]).toBe("unique-key-123");
      }
    });

    it("same payload reference is sent on all retry attempts", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      const canonical = buildCanonicalFromPayload(bundle.payload);
      contract.overrideResult = canonical;
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      await publish();
      expect(http.callLog.length).toBe(3);
      for (const call of http.callLog) {
        expect(call.body).toBe(bundle.payload);
      }
    });

    it("same request hash is recorded in all attempt audits", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      await publish();
      const hashes = publishAttemptRepo.store.map((r) => r.requestHash);
      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe("retry delay is bounded and deterministic", () => {
    it("base delay is 250ms", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0, 0, 0]);
      const { result } = await publish();
      expect(result.outcome).toBe("transient_failure_exhausted");
      expect(retry.delays[0]).toBe(250);
    });

    it("exponential backoff factors are 1 and 2", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0, 0, 0]);
      await publish();
      expect(retry.delays[0]).toBe(250);
      expect(retry.delays[1]).toBe(500);
    });

    it("jitter up to 250ms is added", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0.5, 0.5, 0.5]);
      await publish();
      expect(retry.delays[0]).toBe(375);
      expect(retry.delays[1]).toBe(625);
    });

    it("hard cap of 2000ms is never exceeded", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([1, 1, 1]);
      await publish();
      for (const delay of retry.delays) {
        expect(delay).toBeLessThanOrEqual(2000);
      }
    });

    it("excessive jitter is clamped to 2000ms cap", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([1, 1, 1]);
      await publish();
      expect(retry.delays[0]).toBeLessThanOrEqual(2000);
      expect(retry.delays[1]).toBeLessThanOrEqual(2000);
    });
  });

  describe("valid Retry-After is honored within maximum", () => {
    it("Retry-After delta-seconds is honored", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 429, ok: false, body: {}, headers: { "Retry-After": "1" } } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      retry = new FakeRetry([0]);
      await publish();
      expect(retry.delays[0]).toBe(1000);
    });

    it("Retry-After http date is honored", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      const futureDate = new Date(EPOCH).getTime() + 5000;
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        if (callCount === 1) {
          const httpDate = new Date(futureDate).toUTCString();
          return {
            status: 429,
            ok: false,
            body: {},
            headers: { "Retry-After": httpDate }
          } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      retry = new FakeRetry([0]);
      await publish();
      expect(retry.delays[0]).toBeLessThanOrEqual(2000);
    });
  });

  describe("invalid or excessive Retry-After falls back or clamps", () => {
    it("negative Retry-After falls back to exponential", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 429, ok: false, body: {}, headers: { "Retry-After": "-1" } } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      retry = new FakeRetry([0]);
      await publish();
      expect(retry.delays[0]).toBe(250);
    });

    it("excessive Retry-After is clamped to 2000ms", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 429,
            ok: false,
            body: {},
            headers: { "Retry-After": "5000" }
          } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      retry = new FakeRetry([0]);
      await publish();
      expect(retry.delays[0]).toBeLessThanOrEqual(2000);
    });

    it("non-numeric Retry-After falls back to exponential", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 429,
            ok: false,
            body: {},
            headers: { "Retry-After": "invalid" }
          } as unknown;
        }
        return { status: 201, ok: true, body: { id: "new-123" }, headers: {} } as unknown;
      };
      retry = new FakeRetry([0]);
      await publish();
      expect(retry.delays[0]).toBe(250);
    });
  });

  describe("audit occurs before every retry delay", () => {
    it("audit is persisted before sleep on first retry", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0, 0, 0]);
      await publish();
      expect(publishAttemptRepo.store.filter((r) => r.status === "network_failed")).toHaveLength(3);
    });

    it("no second request is made before first audit is persisted", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let firstRequestComplete = false;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        firstRequestComplete = true;
        throw new Error("ECONNRESET");
      };
      publishAttemptRepo.insertShouldFail = false;
      retry = new FakeRetry([0, 0, 0]);
      void publish();
      await new Promise((r) => setTimeout(r, 10));
      expect(firstRequestComplete).toBe(true);
    });
  });

  describe("audit failure stops publication before another request", () => {
    it("when insert fails, no more requests are made", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        throw new Error("ECONNRESET");
      };
      publishAttemptRepo.insertShouldFail = true;
      retry = new FakeRetry([0, 0, 0]);
      const { result } = await publish();
      expect(result.outcome).toBe("audit_store_failed");
      expect(callCount).toBe(1);
    });

    it("audit insert conflict prevents further requests", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      let callCount = 0;
      (http as unknown as Record<string, unknown>).postJsonRaw = async () => {
        callCount++;
        throw new Error("ECONNRESET");
      };
      publishAttemptRepo.insertConflict = true;
      retry = new FakeRetry([0, 0, 0]);
      const { result } = await publish();
      expect(result.outcome).toBe("audit_store_failed");
      expect(callCount).toBe(1);
    });
  });

  describe("exhausted transient failure is terminal and observable", () => {
    it("transient_failure_exhausted is returned after three failures", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0, 0, 0]);
      const { result } = await publish();
      expect(result.outcome).toBe("transient_failure_exhausted");
    });

    it("transient_failure_exhausted event is emitted", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextError = new HttpRequestError("network", "ECONNRESET", null, true);
      retry = new FakeRetry([0, 0, 0]);
      const { events } = await publish();
      expect(events.some((e) => e.type === "transient_failure_exhausted")).toBe(true);
    });
  });

  describe("concurrent duplicate audit conflict is not reported as success", () => {
    it("when concurrent insert conflict occurs, audit_store_failed is returned", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      publishAttemptRepo.insertConflict = true;
      retry = new FakeRetry([]);
      const { result } = await publish();
      expect(result.outcome).toBe("audit_store_failed");
    });

    it("the losing invocation cannot report remote success", async () => {
      const bundle = makeBundleRow({});
      bundleRepo.store.push(bundle);
      contract.overrideResult = buildCanonicalFromPayload(bundle.payload);
      http.nextResponse = { status: 201, ok: true, body: { id: "new-123" }, headers: {} };
      publishAttemptRepo.insertConflict = true;
      retry = new FakeRetry([]);
      const { result } = await publish();
      expect(result.outcome).not.toBe("created");
    });
  });
});
