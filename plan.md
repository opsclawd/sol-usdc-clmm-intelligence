<!-- plan-review-required -->

# Pyth and Jupiter Price Observation Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist independently collected Pyth SOL/USD oracle updates and Jupiter SOL/USDC executable quotes raw-first, normalize them into source-independent price-quality observations, and expose explicit replay, conflict, freshness, retry, and partial-success outcomes through the existing `collect:price` operator command.

**Architecture:** Extend the HTTP port with a bounded request policy and typed transport failures, add source-specific pure domain modules, and route accepted payloads through one application-level raw-first ingestion lifecycle shared with the CLMM collector. Pyth and Jupiter collectors remain independent and are aggregated only after their durable work settles; Postgres is authoritative, while the existing Jupiter snapshot is updated afterward as a compatibility output.

**Tech Stack:** TypeScript 5.7, Zod, Vitest, Drizzle ORM/Postgres, Node Fetch/AbortController, pnpm.

---

## Goal

Deliver the complete issue #23 ingestion path: authenticated source requests, accepted-envelope validation, exact raw persistence, deterministic identities and hashes, normalized oracle/quote facts with freshness/confidence/provenance, bounded retries, compatibility snapshot behavior, and explicit command-level partial failure semantics.

## Non-goals

- Do not calculate oracle/DEX divergence or any other derived feature.
- Do not collect Orca public statistics, Solana health, on-chain flow, perpetuals, macro, or news.
- Do not construct, simulate, sign, or submit Jupiter transactions, and do not perform user-specific sizing.
- Do not assemble/publish evidence bundles, generate research briefs, or synthesize policy.
- Do not add a durable collection-attempt table or a cross-repository transaction abstraction.
- Do not automatically discover Pyth feeds or migrate Jupiter quote APIs.
- Do not add a database migration unless the production preflight described under Stop Conditions proves historical `price_quote` rows require a compatibility decision.

## Affected files

- `src/ports/http.ts`
- `src/ports/index.ts`
- `src/adapters/node/fetch-http.ts`
- `tests/fakes/fake-http.ts`
- `tests/adapters/node/fetch-http.test.ts` (new)
- `src/application/collect-coingecko.ts`
- `tests/application/ancillary-collectors.test.ts`
- `src/contracts/taxonomy.ts`
- `src/contracts/normalized-price-observation.ts` (new)
- `src/contracts/index.ts`
- `src/domain/taxonomy/registry.ts`
- `src/domain/taxonomy/confidence.ts`
- `src/domain/taxonomy/validation.ts`
- `src/domain/clmm-bundle/enrich.ts`
- `tests/domain/taxonomy/registry.test.ts`
- `tests/domain/taxonomy/confidence.test.ts`
- `tests/domain/taxonomy/validation.test.ts`
- `tests/domain/taxonomy/freshness.test.ts`
- `tests/domain/taxonomy/provenance.test.ts`
- `tests/domain/clmm-bundle/enrich.test.ts`
- `tests/helpers/taxonomy-fixtures.ts`
- `tests/fixtures/pyth-price-update.ts` (new)
- `tests/fixtures/jupiter-quote.ts` (new)
- `src/domain/price-observation/decimal.ts` (new)
- `src/domain/price-observation/pyth.ts` (new)
- `src/domain/price-observation/jupiter.ts` (new)
- `src/domain/price-observation/enrich.ts` (new)
- `src/domain/price-observation/index.ts` (new)
- `tests/domain/price-observation/pyth.test.ts` (new)
- `tests/domain/price-observation/jupiter.test.ts` (new)
- `tests/domain/price-observation/enrich.test.ts` (new)
- `src/application/ingest-raw-observation.ts` (new)
- `src/application/collect-clmm-bundle.ts`
- `tests/application/ingest-raw-observation.test.ts` (new)
- `tests/application/collect-clmm-bundle.test.ts`
- `tests/adapters/node/drizzle-observation-repos.integration.test.ts`
- `src/application/collect-pyth-price.ts` (new)
- `src/application/price-source-result.ts` (new)
- `tests/application/collect-pyth-price.test.ts` (new)
- `src/application/collect-jupiter-quote.ts` (new)
- `src/application/collect-jupiter-price.ts` (compatibility wrapper)
- `tests/application/collect-jupiter-quote.test.ts` (new)
- `tests/application/collect-jupiter-price.test.ts`
- `src/application/collect-price-observations.ts` (new)
- `src/jobs/price-observations-job.ts` (new)
- `src/jobs/jupiter-price-job.ts` (remove after callers move)
- `src/jobs/index.ts`
- `src/adapters/node/composition-root.ts`
- `scripts/collectors/jupiter-price.ts`
- `tests/application/collect-price-observations.test.ts` (new)
- `tests/scripts/price-observations.test.ts` (new)
- `.env.example`
- `README.md`
- `docs/architecture.md`
- `docs/operator-runbook.md`
- `resources/sources.yaml`

## Behavioral invariants

These named cases are written before implementation in the task that owns the behavior:

1. `retries timeout and retryable failures at most once before succeeding or throwing` — each HTTP attempt uses its own five-second abort signal; only network errors, timeouts, 408, 429, and 5xx retry; total attempts never exceed two.
2. `does not retry non-retryable HTTP failures or invalid JSON` — all other 4xx statuses and JSON parse failures stop after one attempt with a typed safe error.
3. `classifies exactly-at-limit price observations as fresh and later observations as stale` — Pyth uses publish time with a 60-second limit; Jupiter uses receipt time with a 30-second limit.
4. `degrades source quality without conflating provider uncertainty with completeness` — confidence ratio/impact above 100 bps adds the source-specific reason and factor `min(1, 100 / observedRatioBps)` while completeness stays field-based.
5. `converts fixed-point and atomic integer strings without binary floating-point loss` — decimal values, bounds, and implied price are exact canonical strings.
6. `uses versioned source identities and detects changed content at the same identity` — identity key changes only when documented identity fields change; canonical response content controls conflicts.
7. `persists raw before normalized and parsed before compatibility output` — accepted envelopes are durable before normalization, normalized rows precede raw `parsed`, and Jupiter snapshot writes last.
8. `reuses a parsed identical replay without duplicate normalization` — parsed replays return the durable raw ID and zero new normalized rows.
9. `recovers pending or failed identical replays from stored canonical payload` — recovery revalidates stored payload, inserts normalized rows idempotently, then marks parsed.
10. `rejects conflicting replay without overwriting the existing row` — conflicts expose both hashes and do not normalize or update compatibility files.
11. `marks raw failed when normalization fails and converges after a status-update failure` — failures after raw insertion mark failed when possible; uniqueness makes a later replay safe even if normalized insertion previously committed.
12. `preserves one source when the other source fails` — aggregation never rolls back the accepted source and returns `isPartial: true` plus a stable warning.
13. `counts stale durable observations as unusable` — stale/degraded rows remain stored but do not increment `usableSourceCount`.
14. `fails the command on total unavailability or any conflict` — both unusable sources or one integrity conflict set a non-zero exit while retaining independent evidence.
15. `updates compatibility snapshot only from normalized Jupiter evidence` — Pyth-only success leaves the file untouched; snapshot failure does not undo database writes.

## Task 1: Add bounded typed HTTP GET behavior

**Files:**

- Modify: `src/ports/http.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/fetch-http.ts`
- Modify: `tests/fakes/fake-http.ts`
- Create: `tests/adapters/node/fetch-http.test.ts`
- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `src/application/collect-coingecko.ts`
- Modify: `src/application/collect-jupiter-price.ts`
- Modify: `tests/application/ancillary-collectors.test.ts`
- Modify: `tests/application/collect-jupiter-price.test.ts`

**Exported API changes:** Change `HttpClient.getJson` to accept one options object and export the policy/error vocabulary used by collectors:

```ts
export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export type HttpFailureKind = "timeout" | "network" | "http_status" | "invalid_json";

export class HttpRequestError extends Error {
  constructor(
    readonly kind: HttpFailureKind,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: ErrorOptions
  );
}

export interface HttpClient {
  getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
}
```

- [ ] **Step 1: Write the transport policy tests first.** In `tests/adapters/node/fetch-http.test.ts`, inject a fetch-compatible function and fake timers/abort-aware promises to name and cover: `retries timeout and retryable failures at most once before succeeding or throwing`, `does not retry non-retryable HTTP failures or invalid JSON`, 408/429/5xx retries, network retry, a new signal for each attempt, response-body truncation/redaction in error summaries, and default single-attempt compatibility. Update `FakeHttp.calls` to capture options and allow queued responses; update the existing CoinGecko header assertion to expect `options.headers`.
- [ ] **Step 2: Run the focused tests and confirm the signature/behavior failures.** Run `pnpm exec vitest run tests/adapters/node/fetch-http.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-price.test.ts tests/application/ancillary-collectors.test.ts`; expect failures because the options signature, error class, fetch injection, retry loop, and authenticated caller argument shapes are not implemented.
- [ ] **Step 3: Implement the port and all implementations in the same task.** Update `FetchHttpClient` to create/clear an `AbortController` per attempt, classify only network/timeout/408/429/5xx as retryable, parse JSON inside the classified attempt, and stop at `maxAttempts`. Export the new types/error from `src/ports/index.ts`, update `FakeHttp`, and change CLMM and CoinGecko calls from bare headers to `{ headers: ... }`; do not persist error bodies or credentials.
- [ ] **Step 4: Update the existing Jupiter price collector and its test to use the new options signature.** In `src/application/collect-jupiter-price.ts` and `tests/application/collect-jupiter-price.test.ts`, change all `http.getJson` calls to pass the headers inside `{ headers: ... }`; the test's `FakeHttp` queue must also reflect the new call shape. This ensures the workspace typechecks after Task 1 before Task 8 introduces the new `collectJupiterQuote` use case.
- [ ] **Step 5: Verify this task.** Run `pnpm exec vitest run tests/adapters/node/fetch-http.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-price.test.ts tests/application/ancillary-collectors.test.ts` and `pnpm exec eslint src/ports/http.ts src/ports/index.ts src/adapters/node/fetch-http.ts tests/fakes/fake-http.ts tests/adapters/node/fetch-http.test.ts src/application/collect-clmm-bundle.ts src/application/collect-coingecko.ts src/application/collect-jupiter-price.ts tests/application/ancillary-collectors.test.ts tests/application/collect-jupiter-price.test.ts`; expect all selected tests and lint checks to pass.
- [ ] **Step 6: Commit.** Run `git add src/ports/http.ts src/ports/index.ts src/adapters/node/fetch-http.ts tests/fakes/fake-http.ts tests/adapters/node/fetch-http.test.ts src/application/collect-clmm-bundle.ts src/application/collect-coingecko.ts src/application/collect-jupiter-price.ts tests/application/ancillary-collectors.test.ts tests/application/collect-jupiter-price.test.ts && git commit -m "feat: bound collector HTTP requests"`.

## Task 2: Define source-independent price contracts and taxonomy rules

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/normalized-price-observation.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/confidence.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `src/domain/clmm-bundle/enrich.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/confidence.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Modify: `tests/domain/taxonomy/freshness.test.ts`
- Modify: `tests/domain/taxonomy/provenance.test.ts`
- Modify: `tests/domain/clmm-bundle/enrich.test.ts`
- Modify: `tests/helpers/taxonomy-fixtures.ts`

**Exported API changes:** Replace the inactive `price_quote` observation kind with `oracle_price` and `executable_quote`; add `pyth-hermes` and `jupiter-quote` sources; remove `ObservationKindEntry.source`; add `oracle_confidence_wide` and `high_price_impact` confidence reasons; export `OraclePricePayloadV1`, `ExecutableQuotePayloadV1`, `PriceObservationWarning`, and `PriceNormalizedCandidate`. Extend `computeConfidence` with an optional final `additionalReasons: readonly ConfidenceReason[] = []` parameter so direct-source reasons are included and deduplicated without overloading completeness semantics.

- [ ] **Step 1: Write taxonomy tests first.** Update only the observation-registry describe blocks in `tests/domain/taxonomy/registry.test.ts` with `registers source-independent price kinds with exclude-on-stale policies`, asserting Pyth 60-second/Jupiter 30-second windows, allowed provenance sources, active schema v1, and absence of singular `source`. Add confidence tests named `degrades source quality without conflating provider uncertainty with completeness` for explicit source-reliability factors and reasons. Update parser, generic freshness/provenance fixtures, and CLMM enrichment tests to use the new kinds/sources while proving CLMM completeness remains keyed only by `ClmmNormalizedCandidate["kind"]`.
- [ ] **Step 2: Run the focused tests and confirm failures.** Run `pnpm exec vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts`; expect type/runtime failures for missing kinds, sources, reason codes, parser values, and price contracts.
- [ ] **Step 3: Add exact normalized contracts.** Store provider integer inputs as strings and define decimal strings for oracle price/confidence/bounds/ratio and quote implied price. Include pair, assets/mints/decimals, observed/source time basis, slot, exact probe/slippage/threshold, route summary, `routeAvailable: true`, and warning arrays; omit unavailable optional values rather than replacing them with zero.
- [ ] **Step 4: Implement registry, parser, confidence, and CLMM typing changes.** Remove every observation entry's singular `source`, rely on `allowedSourceRefs`, use 60,000 ms and 30,000 ms exclude policies, and let callers supply the deterministic source-quality factor and matching reason without changing completeness. Update `oracle_divergence`'s future provenance allowance to `pyth-hermes` and `jupiter-quote` without implementing the feature. Update runtime parser sets, and narrow the CLMM completeness table from all `ObservationKind` values to only CLMM candidate kinds so provider-specific logic stays out of that module.
- [ ] **Step 5: Verify this task.** Run `pnpm exec vitest run tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts` and `pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-price-observation.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/confidence.ts src/domain/taxonomy/validation.ts src/domain/clmm-bundle/enrich.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts tests/helpers/taxonomy-fixtures.ts`; expect all selected checks to pass.
- [ ] **Step 6: Commit.** Run `git add src/contracts/taxonomy.ts src/contracts/normalized-price-observation.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/confidence.ts src/domain/taxonomy/validation.ts src/domain/clmm-bundle/enrich.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/validation.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/provenance.test.ts tests/domain/clmm-bundle/enrich.test.ts tests/helpers/taxonomy-fixtures.ts && git commit -m "feat: define price observation taxonomy"`.

## Task 3: Implement exact Pyth acceptance, identity, and normalization

**Files:**

- Create: `tests/fixtures/pyth-price-update.ts`
- Create: `src/domain/price-observation/decimal.ts`
- Create: `src/domain/price-observation/pyth.ts`
- Create: `src/domain/price-observation/index.ts`
- Create: `tests/domain/price-observation/pyth.test.ts`

**Provider contract:** `acceptPythEnvelope` validates exactly one configured feed update while returning the complete original response for raw storage. `derivePythSourceObservationKey` hashes `{ identityVersion: 1, feedId, publishTimeUnixSeconds }`. `normalizePythPrice` rejects non-positive price and emits exact decimal bounds and ratio bps.

- [ ] **Step 1: Add a sanitized full Hermes fixture and failing tests.** Cover feed mismatch, missing parsed price, invalid integer strings/exponent/time, optional slot, extra envelope fields retained, key-order-stable identity, identity-field changes, negative exponent conversion, exact lower/upper bounds, and no precision loss. Name the arithmetic case `converts fixed-point and atomic integer strings without binary floating-point loss` and the identity case `uses versioned source identities and detects changed content at the same identity`.
- [ ] **Step 2: Run the test and confirm missing modules.** Run `pnpm exec vitest run tests/domain/price-observation/pyth.test.ts`; expect failure because the Pyth and decimal modules do not exist.
- [ ] **Step 3: Implement minimal pure helpers.** Use Zod for shape/string constraints, `BigInt` plus decimal-string shift/division helpers for exact output, canonical hashing for identity, and warning `oracle_confidence_wide` when the absolute confidence-to-price ratio exceeds 100 bps. Never import ports, clocks, or adapters.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/domain/price-observation/pyth.test.ts tests/domain/content-hash.test.ts` and `pnpm exec eslint tests/fixtures/pyth-price-update.ts src/domain/price-observation/decimal.ts src/domain/price-observation/pyth.ts src/domain/price-observation/index.ts tests/domain/price-observation/pyth.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add tests/fixtures/pyth-price-update.ts src/domain/price-observation/decimal.ts src/domain/price-observation/pyth.ts src/domain/price-observation/index.ts tests/domain/price-observation/pyth.test.ts && git commit -m "feat: normalize Pyth oracle prices"`.

## Task 4: Implement exact Jupiter quote acceptance, identity, and normalization

**Files:**

- Create: `tests/fixtures/jupiter-quote.ts`
- Create: `src/domain/price-observation/jupiter.ts`
- Modify: `src/domain/price-observation/index.ts`
- Create: `tests/domain/price-observation/jupiter.test.ts`

**Provider contract:** `acceptJupiterQuote` requires configured SOL/USDC mints, `ExactIn`, `1_000_000_000` input units, positive output, context slot, and a non-empty route. `deriveJupiterSourceObservationKey` hashes `{ identityVersion: 1, inputMint, outputMint, inAmount, swapMode, contextSlot }`.

- [ ] **Step 1: Add a sanitized full quote fixture and failing tests.** Name the contract case `accepts only the deterministic one SOL ExactIn route contract`; cover wrong mints/input/swap mode, missing slot, empty route, zero output, invalid atomic strings, extra response fields retained, stable/versioned identity, exact 6/9-decimal implied price, configured 50 bps slippage, `restrictIntermediateTokens=true`, route summaries, split/multi-hop informational metadata, and `high_price_impact` above 100 bps.
- [ ] **Step 2: Run the test and confirm missing behavior.** Run `pnpm exec vitest run tests/domain/price-observation/jupiter.test.ts`; expect failure because the Jupiter module does not exist.
- [ ] **Step 3: Implement the pure Jupiter module.** Reuse only the exact decimal helpers from Task 3, preserve raw atomic strings, parse price impact as a decimal string without `Number`-based price arithmetic, and distinguish invalid/no-route acceptance errors from accepted warning metadata.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/domain/price-observation/jupiter.test.ts tests/domain/price-observation/pyth.test.ts` and `pnpm exec eslint tests/fixtures/jupiter-quote.ts src/domain/price-observation/jupiter.ts src/domain/price-observation/index.ts tests/domain/price-observation/jupiter.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add tests/fixtures/jupiter-quote.ts src/domain/price-observation/jupiter.ts src/domain/price-observation/index.ts tests/domain/price-observation/jupiter.test.ts && git commit -m "feat: normalize Jupiter executable quotes"`.

## Task 5: Enrich direct price facts with freshness, confidence, and provenance

**Files:**

- Create: `src/domain/price-observation/enrich.ts`
- Modify: `src/domain/price-observation/index.ts`
- Create: `tests/domain/price-observation/enrich.test.ts`

**Exported API:** Add `enrichPriceObservation(input)` returning a complete `NormalizedObservationInsert`-compatible value without importing repository ports. Inputs explicitly include source/raw row metadata, candidate payload, `nowMs`, code version, and pipeline run ID.

- [ ] **Step 1: Write named invariant tests first.** Add `classifies exactly-at-limit price observations as fresh and later observations as stale`, with Pyth based on publish time and Jupiter based on receipt time; `degrades source quality without conflating provider uncertainty with completeness`; and `builds provenance for exactly one accepted raw observation`, asserting its payload hash, collector/job identity, code version, and run ID.
- [ ] **Step 2: Run the focused tests and confirm failure.** Run `pnpm exec vitest run tests/domain/price-observation/enrich.test.ts`; expect failure because the direct enrichment function is absent.
- [ ] **Step 3: Implement direct enrichment.** Select the registry entry by semantic kind, call existing freshness/confidence/provenance functions, derive the source-quality factor from oracle ratio or Jupiter impact, canonically hash the complete normalized payload including warnings, and return `isStale`/`staleBehavior: "exclude"` without CLMM candidate imports.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/domain/price-observation/enrich.test.ts tests/domain/taxonomy/freshness.test.ts tests/domain/taxonomy/confidence.test.ts tests/domain/taxonomy/provenance.test.ts` and `pnpm exec eslint src/domain/price-observation/enrich.ts src/domain/price-observation/index.ts tests/domain/price-observation/enrich.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add src/domain/price-observation/enrich.ts src/domain/price-observation/index.ts tests/domain/price-observation/enrich.test.ts && git commit -m "feat: enrich direct price observations"`.

## Task 6: Extract and adopt the shared raw-first ingestion lifecycle

**Files:**

- Create: `src/application/ingest-raw-observation.ts`
- Create: `tests/application/ingest-raw-observation.test.ts`
- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `tests/application/collect-clmm-bundle.test.ts`
- Modify: `tests/adapters/node/drizzle-observation-repos.integration.test.ts`

**Exported API:** Add `ingestRawObservation<TAccepted, TCandidate>(deps, input)` and provider-neutral `RawObservationConflictError`. The input contains the accepted complete payload, identity/source/times/redacted metadata, a stored-payload revalidator, candidate builder, enrichment callback, and optional post-persist compatibility callback.

- [ ] **Step 1: Write lifecycle tests first.** In the new test file name and cover `persists raw before normalized and parsed before compatibility output`, `reuses a parsed identical replay without duplicate normalization`, `recovers pending or failed identical replays from stored canonical payload`, `rejects conflicting replay without overwriting the existing row`, and `marks raw failed when normalization fails and converges after a status-update failure`. Assert operation order and exact row identities, not just counts.
- [ ] **Step 2: Run lifecycle and CLMM tests to confirm failure.** Run `pnpm exec vitest run tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts`; expect the new module to be absent while existing CLMM behavior remains the regression oracle.
- [ ] **Step 3: Implement the provider-neutral state machine.** Canonicalize the complete accepted payload; call `insertOrClassify`; return immediately for parsed replay; revalidate stored canonical JSON for pending/failed replay; insert enriched normalized rows idempotently; mark parsed; on normalization/enrichment/insert failure attempt `failed` without masking the original error; and invoke compatibility output only after parsed status.
- [ ] **Step 4: Refactor CLMM to call the shared lifecycle.** Preserve its public result, wallet hashing/redaction, envelope validation-before-raw rule, stored-payload recovery, and latest-file behavior. Replace `ClmmObservationConflictError` with a compatibility alias/subclass if external tests require its name, but keep provider-neutral conflict fields.
- [ ] **Step 5: Extend repository integration coverage.** In the existing integration test add parameterized `pyth-hermes` and `jupiter-quote` identity cases proving concurrent identical inserts classify as replay and changed content classifies as conflict; no migration is expected because source/kind columns are text.
- [ ] **Step 6: Verify this task.** Run `pnpm exec vitest run tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts` and `pnpm exec eslint src/application/ingest-raw-observation.ts tests/application/ingest-raw-observation.test.ts src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts`; expect all selected checks to pass (the integration file may skip only when its documented database prerequisite is absent).
- [ ] **Step 7: Commit.** Run `git add src/application/ingest-raw-observation.ts tests/application/ingest-raw-observation.test.ts src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts tests/adapters/node/drizzle-observation-repos.integration.test.ts && git commit -m "refactor: share raw-first observation ingestion"`.

## Task 7: Collect and durably ingest Pyth oracle updates

**Files:**

- Create: `src/application/collect-pyth-price.ts`
- Create: `src/application/price-source-result.ts`
- Create: `tests/application/collect-pyth-price.test.ts`

**Exported API:** Add the shared discriminated `PriceSourceResult` union in `src/application/price-source-result.ts`, covering durable statuses (`accepted`, `identical_replay`, `stale`, `degraded`) and failure statuses (`timeout`, `unavailable`, `malformed`, `no_route`, `conflict`, `failed`) with nullable durable IDs, warning codes, freshness, and a safe summary. Add `collectPythPrice(deps): Promise<PriceSourceResult>`.

- [ ] **Step 1: Write source-use-case tests first.** Add `persists an accepted Pyth envelope before normalization and rejects malformed envelopes before raw insert`, `records redacted Pyth request metadata without credentials`, and `persists stale oracle evidence and returns an unusable stale outcome`. Assert the authenticated Hermes URL/path/feed query, `{ timeoutMs: 5_000, maxAttempts: 2 }`, receipt and publish timestamps, parsed replay, failed replay, conflict, wide-confidence degradation, and stable safe summaries for typed timeout/network/HTTP failures.
- [ ] **Step 2: Run the focused test and confirm failure.** Run `pnpm exec vitest run tests/application/collect-pyth-price.test.ts`; expect failure because the collector does not exist.
- [ ] **Step 3: Implement the shared result union and Pyth collector.** Read `PYTH_HERMES_BASE_URL`, `PYTH_API_KEY`, and `PYTH_SOL_USD_FEED_ID`; request `/v2/updates/price/latest` for exactly that feed; validate the complete envelope; derive its key; build redacted host/path/feed/version/run metadata; and pass normalization/enrichment callbacks to `ingestRawObservation`. Map freshness/confidence to `accepted`, `identical_replay`, `stale`, or `degraded`, and transport/validation/integrity failures to stable non-secret `PriceSourceResult` variants.
- [ ] **Step 4: Verify this task.** Run `pnpm exec vitest run tests/application/collect-pyth-price.test.ts tests/domain/price-observation/pyth.test.ts tests/application/ingest-raw-observation.test.ts` and `pnpm exec eslint src/application/price-source-result.ts src/application/collect-pyth-price.ts tests/application/collect-pyth-price.test.ts`; expect all selected checks to pass.
- [ ] **Step 5: Commit.** Run `git add src/application/price-source-result.ts src/application/collect-pyth-price.ts tests/application/collect-pyth-price.test.ts && git commit -m "feat: ingest Pyth oracle updates"`.

## Task 8: Collect Jupiter quotes and update the compatibility snapshot last

**Files:**

- Create: `src/application/collect-jupiter-quote.ts`
- Create: `tests/application/collect-jupiter-quote.test.ts`
- Modify: `tests/application/collect-jupiter-price.test.ts`
- Modify: `src/application/collect-jupiter-price.ts`
- Modify: `src/jobs/jupiter-price-job.ts`
- Modify: `src/adapters/node/composition-root.ts`

**Exported API:** Add `collectJupiterQuote(deps): Promise<PriceSourceResult>` and retain `collectJupiterPrice` as a deprecated compatibility wrapper with the new durable result, so existing imports remain typecheckable while `data/latest-price-snapshot.json` remains a post-ingest compatibility contract.

- [ ] **Step 1: Write quote-use-case tests first.** Add `requests the deterministic generic Jupiter quote contract`; assert authenticated quote-only GET parameters: configured SOL/USDC mints, `amount=1000000000`, `swapMode=ExactIn`, `slippageBps=50`, and `restrictIntermediateTokens=true`, plus bounded HTTP options and redacted metadata. Cover malformed/no-route-before-raw, stale/high-impact outcomes, replay/conflict, `updates compatibility snapshot only from normalized Jupiter evidence`, and `preserves durable Jupiter evidence when compatibility snapshot writing fails`.
- [ ] **Step 2: Convert the small legacy collector tests.** Replace the three old Price v3 expectations with compatibility assertions against normalized quote output and ensure the old endpoint/`usdPrice` response can no longer become authoritative evidence.
- [ ] **Step 3: Run focused tests and confirm failure.** Run `pnpm exec vitest run tests/application/collect-jupiter-quote.test.ts tests/application/collect-jupiter-price.test.ts`; expect failures until the new collector replaces the old implementation.
- [ ] **Step 4: Implement the Jupiter collector and compatibility wrapper.** Build the deterministic URL, validate before raw insert, derive identity, build redacted request metadata without headers/API key, call shared ingestion, and write the existing `PriceSnapshot` shape from the exact implied quote price only after normalized persistence and parsed status. Convert to `number` only at the legacy file boundary after a finite/range check; keep DB values exact strings. Make the old module delegate/re-export the new use case rather than retaining Price v3 logic.
- [ ] **Step 5: Wire the new Jupiter dependencies into the existing job and composition root.** In `src/jobs/jupiter-price-job.ts` and `src/adapters/node/composition-root.ts`, add `JUPITER_API_BASE` and `JUPITER_API_KEY` to the deps resolved for `collectJupiterPrice`/`collectJupiterQuote`. This ensures the new collector's deps are available when `collectJupiterPrice` delegates to it, before Task 9 aggregates both sources.
- [ ] **Step 6: Verify this task.** Run `pnpm exec vitest run tests/application/collect-jupiter-quote.test.ts tests/application/collect-jupiter-price.test.ts tests/domain/price-observation/jupiter.test.ts tests/application/ingest-raw-observation.test.ts` and `pnpm exec eslint src/application/collect-jupiter-quote.ts src/application/collect-jupiter-price.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-jupiter-price.test.ts src/jobs/jupiter-price-job.ts src/adapters/node/composition-root.ts`; expect all selected checks to pass.
- [ ] **Step 7: Commit.** Run `git add src/application/collect-jupiter-quote.ts tests/application/collect-jupiter-quote.test.ts tests/application/collect-jupiter-price.test.ts src/application/collect-jupiter-price.ts src/jobs/jupiter-price-job.ts src/adapters/node/composition-root.ts && git commit -m "feat: ingest Jupiter executable quotes"`.

## Task 9: Aggregate independent outcomes and rewire the operator command

**Files:**

- Create: `src/application/collect-price-observations.ts`
- Create: `tests/application/collect-price-observations.test.ts`
- Create: `src/jobs/price-observations-job.ts`
- Remove: `src/jobs/jupiter-price-job.ts`
- Modify: `src/jobs/index.ts`
- Modify: `src/adapters/node/composition-root.ts`
- Modify: `scripts/collectors/jupiter-price.ts`
- Create: `tests/scripts/price-observations.test.ts`

**Exported API changes:** Add `collectPriceObservations`, `CollectPriceObservationsResult`, per-source status/result unions, and `runPriceObservationsJob`; remove `runJupiterPriceJob`. The result always has Pyth and Jupiter outcomes, aggregate warnings, `isPartial`, `usableSourceCount`, and `shouldFailCommand`.

- [ ] **Step 1: Write aggregate state tests first.** Name and cover `preserves one source when the other source fails`, `counts stale durable observations as unusable`, `fails the command on total unavailability or any conflict`, and `starts both independent source pipelines before awaiting either result`. Also cover both usable success, parsed replay usability, deterministic warning ordering, and null/omitted missing fields rather than zeros.
- [ ] **Step 2: Write CLI tests first.** Inject/job-stub the script entrypoint so it prints the structured result, leaves exit code zero for complete or partial usable success, and sets a non-zero code for total failure or conflict without throwing away the result.
- [ ] **Step 3: Run focused tests and confirm failure.** Run `pnpm exec vitest run tests/application/collect-price-observations.test.ts tests/scripts/price-observations.test.ts`; expect failures for missing aggregator/job wiring.
- [ ] **Step 4: Implement independent aggregation.** Start both source calls before awaiting and use `Promise.allSettled` (or equivalent) to map every failure to one source outcome. Count only non-stale accepted/replay observations as usable; preserve accepted evidence on peer failure; make any conflict an integrity-level command failure.
- [ ] **Step 5: Rewire composition, job, exports, and script.** Resolve both repositories from `getPersistence()`, pass one runtime clock/http/env and JSON store, retain the `pnpm collect:price` script name, output safe structured JSON, and remove the old Jupiter-only job. The script must never log API keys, headers, raw provider payloads, or full transport bodies.
- [ ] **Step 6: Verify this task.** Run `pnpm exec vitest run tests/application/collect-price-observations.test.ts tests/scripts/price-observations.test.ts tests/application/collect-pyth-price.test.ts tests/application/collect-jupiter-quote.test.ts` and `pnpm exec eslint src/application/collect-price-observations.ts tests/application/collect-price-observations.test.ts src/jobs/price-observations-job.ts src/jobs/index.ts src/adapters/node/composition-root.ts scripts/collectors/jupiter-price.ts tests/scripts/price-observations.test.ts`; expect all selected checks to pass and `test ! -e src/jobs/jupiter-price-job.ts` to succeed.
- [ ] **Step 7: Commit.** Run `git add src/application/collect-price-observations.ts tests/application/collect-price-observations.test.ts src/jobs/price-observations-job.ts src/jobs/jupiter-price-job.ts src/jobs/index.ts src/adapters/node/composition-root.ts scripts/collectors/jupiter-price.ts tests/scripts/price-observations.test.ts && git commit -m "feat: aggregate durable price collection"`.

## Task 10: Document configuration, authority, and operational failure semantics

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`
- Modify: `resources/sources.yaml`

- [ ] **Step 1: Update configuration and source registry.** Add `PYTH_HERMES_BASE_URL`, `PYTH_API_KEY`, `PYTH_SOL_USD_FEED_ID`, `JUPITER_API_BASE`, and `JUPITER_API_KEY`; replace the Price v3 source entry with authenticated Pyth Hermes and Jupiter quote-only entries, exact probe/slippage/timeout policy, and source limitations.
- [ ] **Step 2: Update architecture and README sections.** State the raw-first two-source flow, source-independent kinds, Postgres authority, no oracle/DEX feature in this issue, generic/non-execution Jupiter evidence, and the compatibility file's non-authoritative/staleness caveat. Keep `pnpm collect:price` as the operator interface.
- [ ] **Step 3: Update the runbook.** Document required credentials, expected complete/partial/conflict/total-failure exit behavior, safe troubleshooting, fresh/stale queries using actual `raw_observations` and `normalized_observations` column names, and a manual pre-deployment query for historical `price_quote` rows. Do not include real keys or provider response bodies.
- [ ] **Step 4: Verify this task.** Run `pnpm exec prettier --check .env.example README.md docs/architecture.md docs/operator-runbook.md resources/sources.yaml` and `pnpm exec vitest run tests/regression/cron-render.fixture.test.ts`; expect formatting and the unaffected operator-command fixture to pass.
- [ ] **Step 5: Commit.** Run `git add .env.example README.md docs/architecture.md docs/operator-runbook.md resources/sources.yaml && git commit -m "docs: operate durable price observation collection"`.

## Tests to add or update

- Add transport adapter tests for abort, retry classification, maximum attempts, invalid JSON, and safe typed errors.
- Update taxonomy registry/confidence tests for semantic kinds, provider sources, freshness windows, and source-quality reasons.
- Add fixture-driven pure Pyth/Jupiter tests for acceptance, identities, exact arithmetic, warnings, and missing-value behavior.
- Add direct enrichment tests for boundary freshness, quality factors, hashes, and one-raw-row provenance.
- Add shared lifecycle tests for insertion order, replay recovery, conflict, parse-state failure, and compatibility ordering; preserve CLMM regression coverage.
- Extend Postgres repository integration coverage for both new source literals and identity conflicts.
- Add source application tests for configuration, redaction, durable ordering, stale/degraded outcomes, and compatibility behavior.
- Add aggregator and CLI tests for concurrency, partial success, total failure, conflict, usable counts, warning ordering, and exit codes.
- Update the small legacy Jupiter test file to prove the operator-facing snapshot remains compatible while Price v3 loses evidence authority.

## Validation commands

The implementation loop runs its automatic workspace-wide `pnpm -r typecheck` gate after every task. Each task above additionally lists commands scoped to its explicit files. After all implementation tasks complete, the dedicated validate phase should run these repository acceptance commands without creating another task:

```bash
pnpm verify
git diff --check
git status --short
```

Expected: `pnpm verify` completes typecheck, lint, format, tests, and dependency boundaries successfully; `git diff --check` emits no whitespace errors; `git status --short` shows only the intended implementation changes if commits were intentionally deferred.

## Risk areas

- Pyth Hermes envelope/authentication and Jupiter quote-only endpoint contracts may drift; sanitized fixtures deliberately pin accepted fields, and live API tests remain opt-in.
- Jupiter may return different routes in the same context slot; the conservative identity treats changed content as a visible conflict rather than silently broadening identity.
- Jupiter has no wall-clock source timestamp, so its 30-second freshness is receipt-relative and must not be described as source-publish freshness.
- Pyth `conf`, Jupiter price impact, and repository confidence are separate concepts; mixing them would corrupt auditability.
- Normalized insertion and raw parse-status update are separate operations; idempotent uniqueness and replay recovery must remain convergent.
- Pyth-only success intentionally leaves an older compatibility snapshot in place; documentation and result warnings are essential for legacy readers.
- A compatibility snapshot converts exact DB price text to a JS number; that lossy boundary must be isolated and range-checked.
- Error/log redaction must exclude API keys, authorization headers, wallet data, and full provider bodies.

## Stop conditions

- Abort before taxonomy replacement if the documented production preflight finds existing `normalized_observations.observation_kind = 'price_quote'` rows and no approved compatibility/migration decision is available; retain the old kind inactive rather than rewriting history.
- Abort source implementation if current official provider contracts no longer offer authenticated Pyth parsed updates or a read-only Jupiter quote endpoint without transaction/instruction construction; do not silently substitute another authority.
- Abort if accepting a provider response requires persisting credentials, authorization headers, wallet/user addresses, or transaction material.
- Abort if a required port/interface method cannot be changed together with every implementation/fake in the same task.
- Abort if dependency-boundary rules would require domain code to import ports, application code, adapters, Node built-ins, or database modules; revise the boundary instead of weakening `.dependency-cruiser.cjs`.
- Abort if repository uniqueness no longer enforces `(source, source_observation_key)` for raw rows or `(raw_observation_id, observation_kind, payload_hash)` for normalized rows; resolve the persistence prerequisite before relying on replay semantics.
- Abort rather than fabricate a value when price, confidence, output amount, publish time, context slot, route, or configured identity is missing/invalid.
