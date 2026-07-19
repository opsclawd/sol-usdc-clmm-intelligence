# Pyth and Jupiter SOL/USDC Price Observation Ingestion

**Issue:** #23  
**Status:** Design  
**Date:** 2026-07-18  
**Parent:** #7  
**Blocked by:** #22 (complete on the current branch)

## Summary

Add one price-collection job that independently requests a Pyth SOL/USD oracle update and a Jupiter SOL-to-USDC executable quote. Each valid source response is validated, canonically hashed, and persisted to `raw_observations` before any normalized row is written. Source-specific normalizers then produce two source-independent price-quality facts with freshness, confidence, and provenance:

- `oracle_price` for a canonical SOL/USD price and confidence interval;
- `executable_quote` for a deterministic SOL/USDC exact-input route quote and its implied price.

The two source pipelines do not share a database transaction. The job aggregates their outcomes so that either source can succeed without the other, while conflicts and total failure remain visible. This extends the raw-first/idempotent lifecycle introduced by #22 instead of retaining the existing latest-file-only Jupiter price collector as the evidence authority.

No oracle/DEX comparison or policy conclusion is produced here.

## Problem and why it matters

The current `collectJupiterPrice` use case calls Jupiter Price v3 and writes `data/latest-price-snapshot.json`. It does not retain raw responses in Postgres, link normalized facts to raw evidence, distinguish replays from conflicts, enforce source freshness, or expose partial-source outcomes. It is also a token-price lookup rather than an executable route quote.

The deterministic feature pipeline needs two different market views:

1. an oracle value whose uncertainty and publish time are explicit; and
2. an amount-specific DEX route value that reflects currently available liquidity.

Without durable raw payloads and exact lineage, a later divergence feature cannot be reproduced or audited. Without freshness and confidence semantics, an old oracle update or a wide Pyth interval can look equivalent to a current, tight observation. Without partial-success handling, a transient failure from one provider discards independent evidence from the other.

## Codebase findings that shape the design

- #22 established the required lifecycle in `collect-clmm-bundle.ts`: validate the source envelope, canonicalize the accepted payload, derive a source observation identity, call `insertOrClassify`, normalize only after raw persistence, recover pending/failed identical replays, and reject conflicting content for the same identity.
- `raw_observations` is uniquely keyed by `(source, source_observation_key)`. `normalized_observations` is uniquely keyed by `(raw_observation_id, observation_kind, payload_hash)`. These constraints already support this issue; no database migration is required.
- The taxonomy currently has only `price_quote`, associates each observation registry entry with a singular `source`, and lists only Jupiter Price sources. This conflicts with the requirement that semantic kinds be source-independent and does not model an oracle confidence interval.
- CLMM enrichment is coupled to `ClmmNormalizedCandidate` and a CLMM-only completeness table. Price observations should use the same taxonomy functions without adding Pyth and Jupiter branches to the CLMM module.
- `HttpClient.getJson` has no timeout or typed transport failure, and `FetchHttpClient` makes one unbounded `fetch` call. The transport port must expose bounded request policy for this issue.
- The existing `collect:price` command and `data/latest-price-snapshot.json` are documented operator interfaces. They should remain compatibility surfaces, but the database becomes authoritative.
- Official Pyth documentation exposes parsed price, `conf`, exponent, publish time, feed ID, and slot through Hermes `/v2/updates/price/latest`. It also documents `price +/- conf` and the shared fixed-point exponent. The upgraded Hermes endpoint requires bearer authentication, so the design treats credentials as required configuration rather than depending on a temporary unauthenticated public service.
- Jupiter's quote-only Swap v1 endpoint returns exact input/output atomic amounts, route plan, price impact, and context slot. Jupiter now marks Swap v1 as superseded by Swap v2; however, V2 endpoints also construct transactions or instructions. A read-only intelligence collector should not request transaction material merely to obtain evidence, so the quote-only endpoint is isolated behind an adapter and its deprecation is an explicit operational risk.

## Design decisions

### 1. Use two semantic observation kinds

Replace the unused DB-ingestion placeholder `price_quote` with:

| Kind               | Meaning                                            | Current allowed source | Freshness                                                     |
| ------------------ | -------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `oracle_price`     | Canonical base/quote oracle value with uncertainty | `pyth-hermes`          | 60 seconds from source publish time; stale behavior `exclude` |
| `executable_quote` | Exact-input route quote for a fixed probe size     | `jupiter-quote`        | 30 seconds from receipt; stale behavior `exclude`             |

The names describe facts, not providers. Source identity remains in the raw row and provenance. Existing `jupiter-price` and `jupiter-price-v3` source literals may remain for historical/legacy file compatibility, but new DB rows use `jupiter-quote`.

`ObservationKindEntry.source` should be removed because `provenanceRequirements.allowedSourceRefs` already expresses allowed providers and supports more than one. This is a focused taxonomy correction exposed by the issue, not a new taxonomy system.

There is no evidence in the codebase of `price_quote` DB writes, so no data migration is proposed. Before implementation, an operator should still query production for that value; if rows exist, retain `price_quote` as an inactive compatibility kind rather than renaming historical records.

### 2. Share the ingestion lifecycle, not the source model

Add a small application-level raw-first ingestion service that owns only the common state machine:

1. receive an already transport-validated source payload and identity fields;
2. canonicalize the complete response object;
3. insert or classify the raw row as inserted, identical replay, or conflict;
4. on an already-parsed identical replay, return without writing normalized duplicates;
5. on inserted, pending, or failed rows, revalidate the stored canonical payload and invoke the source normalizer;
6. insert normalized rows idempotently;
7. mark the raw row `parsed`, or `failed` if normalization/enrichment fails.

The service accepts source-specific callbacks for canonical-payload validation and normalized-row construction. It does not know Pyth fields, Jupiter routes, or CLMM bundles. The #22 collector can adopt this service as a small follow-on refactor within this issue only if behavior remains covered by its existing tests; otherwise the price pipeline should reproduce its state transitions through a price-scoped helper and leave CLMM untouched. The important invariant is one lifecycle, not an ambitious generic framework.

Raw persistence occurs after the response is proven to be an accepted source envelope but before decimal conversion, normalization, freshness, confidence, or provenance work. Zod validation must inspect the response without replacing it with a stripped object; the complete original JSON response is what is canonicalized and stored.

### 3. Keep source adapters and normalizers isolated

Create bounded modules under a price-observation domain area:

- Pyth schema acceptance, identity derivation, fixed-point conversion, and normalization;
- Jupiter schema acceptance, identity derivation, amount conversion, route warning extraction, and normalization;
- direct-observation enrichment that uses the existing taxonomy freshness, confidence, hashing, and provenance functions without depending on CLMM payload types.

This keeps each unit pure and fixture-testable. The application layer owns request ordering and repositories; the Node adapter owns HTTP mechanics; the job and script remain thin composition wrappers.

### 4. Use exact numeric representations

Provider integers and atomic amounts remain strings in normalized payloads. Human-readable decimal values are computed with `BigInt`/decimal-string helpers, never binary floating-point.

The oracle payload includes at minimum:

- `kind`, `schemaVersion`, `pair: "SOL/USD"`, and `observedAtUnixMs`;
- `baseAsset: "SOL"`, `quoteAsset: "USD"`;
- Pyth feed ID in a provider-neutral `instrumentId` field;
- raw `price`, raw `confidence`, and exponent;
- decimal price and confidence half-width strings;
- decimal lower and upper confidence bounds;
- confidence-to-price ratio in basis points;
- source publish time and context slot when present;
- warning codes.

The executable quote payload includes at minimum:

- `kind`, `schemaVersion`, `pair: "SOL/USDC"`, and `observedAtUnixMs`;
- input/output mint, symbol, decimals, and raw amounts;
- `swapMode: "ExactIn"` and the exact probe amount;
- implied USDC-per-SOL decimal string;
- `otherAmountThreshold`, configured slippage basis points, price-impact string, context slot, and route plan summary;
- `routeAvailable: true` and warning codes.

The implied quote price is normalization of exact source quantities, not a cross-source derived feature. Oracle/DEX divergence remains out of scope.

### 5. Make the quote probe deterministic

Use exactly `1_000_000_000` lamports (1 SOL) as an ExactIn probe to the configured mainnet USDC mint, with:

- `slippageBps=50`;
- `restrictIntermediateTokens=true`;
- no platform fee;
- no user/taker address;
- no transaction-building or execution request.

One SOL is large enough to expose executable-route quality while remaining a generic market probe. The request parameters and mint identities are included in redacted `sourceRequestMeta`. API keys and headers are never persisted.

### 6. Define deterministic identities and conflicts

Identity payloads are versioned and canonically hashed:

- Pyth: `{ identityVersion: 1, feedId, publishTimeUnixSeconds }`.
- Jupiter: `{ identityVersion: 1, inputMint, outputMint, inAmount, swapMode, contextSlot }`.

For Pyth, a different response for the same feed publication is a conflict. For Jupiter, context slot plus the complete deterministic request defines the source observation. Different route content for that identity is also a conflict rather than a silent overwrite. `contextSlot` is therefore required for accepted Jupiter responses; accepting responses without it would force receipt-time identities that cannot support meaningful replay detection.

Content hashes cover the complete accepted response. Normalized hashes cover the source-independent normalized payload, including warning metadata.

### 7. Model source quality separately from Pyth's confidence interval

Pyth's `conf` is provider-reported market uncertainty, not the repository's aggregate `Confidence` object. Both are retained under distinct names.

The taxonomy gains versioned price-quality rules:

- Pyth freshness is based on `publish_time`, with a maximum observed age of 60 seconds.
- A Pyth confidence half-width at or below 100 basis points of the absolute price passes the initial quality threshold. Above that threshold the observation is still persisted and normalized, receives `oracle_confidence_wide`, and its confidence source-quality factor is deterministically capped at `min(1, 100 / observedRatioBps)`. A zero or negative oracle price is malformed and rejected before raw acceptance.
- Jupiter freshness is based on receipt time because the quote response supplies a slot but no wall-clock source timestamp. It is valid for 30 seconds.
- A missing/empty route, wrong mints, changed probe input, non-ExactIn response, non-positive output, or missing context slot is not an accepted quote. High price impact (initially above 100 basis points) is accepted with `high_price_impact` and a deterministic source-quality factor using the same threshold/observed-ratio rule. Split or multi-hop routes are preserved as informational metadata, not automatically treated as invalid.

These thresholds are code-owned, registry-versioned policy constants with tests, not environment knobs. They can be changed later through an explicit taxonomy decision. Completeness still measures field presence; it must not be used as a proxy for wide confidence or high price impact. The `ConfidenceReason` union should gain source-quality reasons rather than mislabeling these cases as stale.

### 8. Aggregate partial outcomes explicitly

`collectPriceObservations` launches both independent source use cases with `Promise.allSettled` (or equivalent). There is no transaction spanning sources and no fail-fast await ordering.

The returned result contains one status per source:

- `accepted` or `identical_replay`, with raw ID, normalized count, and freshness;
- `stale` or `degraded`, with the same durable IDs and warning codes;
- `timeout`, `unavailable`, `malformed`, `no_route`, or `conflict`, with a stable warning code and safe error summary.

It also contains `isPartial`, `usableSourceCount`, and aggregate warnings. Missing values are omitted/null, never zero. A source transport or envelope failure creates no raw observation because there is no accepted payload. Its unavailability is recorded in the job result and structured logs; adding a collection-attempt table is outside this issue.

Command behavior is:

- both sources usable: exit successfully;
- one source usable: exit successfully with `isPartial: true` and warnings;
- no source usable: exit non-zero;
- any identity conflict: preserve all independently accepted evidence but exit non-zero because a conflict is an integrity failure.

A stale normalized row is durable for audit but does not count as usable. The taxonomy's `exclude` behavior ensures later fresh-evidence queries cannot silently consume it.

### 9. Bound timeout and retry behavior

Extend the HTTP port with request options and typed transport errors while preserving GET-only use:

- 5-second timeout per attempt;
- at most 2 attempts total;
- retry only network errors, timeouts, HTTP 408, 429, and 5xx;
- never retry other 4xx responses or schema/semantic validation failures.

The Fetch adapter implements abort and retry classification. Tests use the fake HTTP client to assert that source collectors pass the policy and adapter tests verify retry limits. Because raw insertion happens only after an accepted response, retries cannot create raw duplicates; the database identity constraint remains the concurrency backstop.

### 10. Preserve operator compatibility without preserving authority

Keep `pnpm collect:price` as the operator command, but rewire it to the combined durable price job. On a successfully normalized Jupiter quote, update `data/latest-price-snapshot.json` with the quote's implied price for legacy readers. The write occurs after database normalization and is explicitly non-authoritative, matching #22's compatibility-file ordering.

Pyth-only success does not overwrite the Jupiter compatibility snapshot with an oracle value. The structured command result warns that Jupiter is unavailable, so operators do not mistake an older file for current evidence. README, architecture documentation, operator runbook, `.env.example`, and `resources/sources.yaml` must state the database authority and the generic, non-execution nature of the quote.

Required configuration:

- `PYTH_HERMES_BASE_URL`;
- `PYTH_API_KEY`;
- `PYTH_SOL_USD_FEED_ID`;
- `JUPITER_API_BASE`;
- `JUPITER_API_KEY`;
- existing `SOL_MINT` and `USDC_MINT`.

The source request metadata records method, host/path, feed or mint identity, probe parameters, code version, and pipeline run ID. It excludes credentials, headers, wallet data, and any transaction material.

## Alternatives considered

### A. Shared bounded lifecycle plus source-specific modules — recommended

This reuses #22's hard-won persistence semantics, keeps provider contracts isolated, and provides one place for replay/conflict/status handling. It introduces a modest abstraction, but that abstraction is constrained to the lifecycle already repeated by durable collectors.

### B. Two fully independent collection use cases that copy #22

This is initially faster and keeps each file self-contained. It was rejected because raw status recovery, conflict handling, parse-status transitions, and provenance construction would immediately exist in three subtly different implementations. That is precisely the second ingestion architecture the issue says to avoid.

### C. A generic declarative collector framework

A registry could define URLs, schemas, identity selectors, retries, normalization, and persistence for all future sources. It was rejected as too broad for a PR-sized child of #7. Pyth and Jupiter have materially different time and identity semantics, and a framework designed from only two examples would hide rather than eliminate that complexity.

### D. Continue Jupiter Price v3 and add Pyth beside it

This would minimize changes and preserve the current snapshot shape. It was rejected because a token-price lookup is not an amount-specific executable route, does not expose route availability or price impact, and fails the issue's core evidence requirement.

## Data flow

```text
Pyth Hermes GET --------------------> validate accepted envelope
                                              |
Jupiter quote-only GET ------------> validate accepted quote
             |                                |
             +---------- independent source pipelines ----------+
                                                                  |
                 canonical payload + versioned identity           |
                                  |                               |
                                  v                               v
                         raw_observations                 raw_observations
                                  |                               |
                    source-specific normalization and direct enrichment
                                  |                               |
                                  v                               v
                    oracle_price normalized row   executable_quote normalized row
                                  \                               /
                                   +---- aggregate source result -+
                                                  |
                                  optional legacy Jupiter snapshot
```

## Error and recovery semantics

| Failure                                                        | Durable effect                                                                 | Source outcome              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| Missing config, timeout, network failure, rejected HTTP status | No raw row                                                                     | unavailable/timeout         |
| Malformed Pyth/Jupiter response                                | No raw row                                                                     | malformed/no_route          |
| Accepted payload, raw insert fails                             | No guaranteed evidence; normalization does not run                             | failed                      |
| Same identity and same hash, already parsed                    | Existing rows reused; no duplicate normalized row                              | identical_replay            |
| Same identity and same hash, pending/failed                    | Stored canonical payload is revalidated and normalization retried              | accepted or failed          |
| Same identity and different hash                               | Existing row unchanged; other source continues                                 | conflict                    |
| Normalization/enrichment fails                                 | Raw row marked failed where possible; no fabricated normalized fact            | failed                      |
| Normalized insert commits, raw status update fails             | Replay recovers idempotently because normalized uniqueness prevents duplicates | failed, recoverable         |
| Compatibility-file write fails                                 | Database evidence remains authoritative; command reports failure               | failed after durable ingest |

## Testing strategy

### Pure domain tests

- Pyth and Jupiter Zod schemas accept complete fixtures and reject wrong feed/mints, non-finite/invalid numeric strings, missing timestamps/slots, zero output, and empty routes.
- Fixed-point and atomic-unit conversion produces exact decimal strings for positive and negative exponents without precision loss.
- Each identity is stable under object key ordering, changes when an identity field changes, and conflicts when content changes under one identity.
- Normalizers produce source-independent payloads and never substitute zero for missing values.
- Freshness boundary tests cover exactly-at-limit, stale Pyth publish time, and receipt-based Jupiter validity.
- Wide Pyth confidence and high Jupiter impact produce deterministic quality factors and warning reasons.
- Provenance points to exactly one raw row with the correct source and process metadata.

### Application tests

- For each source, raw insertion is observed before normalized insertion.
- Inserted, parsed replay, failed replay, and conflicting replay follow #22 semantics.
- Pyth-only and Jupiter-only outcomes preserve the successful source and return explicit warnings.
- Both-source failure returns no fabricated facts and fails the job.
- A source conflict does not roll back the other source but fails the command.
- Stale source payloads are retained, marked stale, and excluded from `usableSourceCount`.
- A successful Jupiter normalization updates the compatibility file only afterward; Pyth-only success does not rewrite it.

### Adapter and integration tests

- Fetch timeout aborts at the configured bound.
- Retryable statuses/errors are attempted no more than twice; non-retryable statuses and malformed JSON are not retried.
- Repository integration verifies concurrent identical insertion returns replay and differing content returns conflict for both new source literals.
- Existing CLMM collector tests remain green if the shared lifecycle is adopted.
- Full `pnpm verify` covers typecheck, lint, format, tests, and dependency boundaries.

Live API tests are not part of the normal test suite. Checked-in sanitized fixtures define the accepted provider contracts; an optional operator smoke command may verify credentials and endpoint drift without writing if explicitly invoked.

## Assumptions

1. Pyth Hermes is the approved canonical oracle; no generic token-price substitute is needed.
2. Production can provide Pyth and Jupiter API keys. This is important because current official roadmaps require authenticated access.
3. The configured Pyth feed ID is the stable mainnet `Crypto.SOL/USD` feed and is verified in operator documentation rather than silently discovered at runtime.
4. SOL has 9 decimals and mainnet USDC has 6, but both decimals are represented explicitly in the normalized schema and validated against configured expectations.
5. One SOL is the intended generic probe size; it is not derived from wallet balances or an intended trade.
6. Jupiter `contextSlot` is present on accepted quote responses and is stable enough to anchor source identity. Responses without it are unavailable rather than assigned receipt-time identities.
7. A 60-second Pyth freshness window, 30-second Jupiter window, 100-basis-point oracle confidence threshold, and 100-basis-point price-impact warning threshold are suitable initial taxonomy policies. They are versioned and can be revised explicitly.
8. Partial success is operational success with degradation; total unavailability and identity conflicts are command failures.
9. No external consumer currently depends on normalized `price_quote` rows. Production is checked before removing that placeholder kind.
10. Failure-attempt history can be observed through structured job output/logging for this issue; durable attempt telemetry is a separate concern.

## Scope

### In scope

- Authenticated Pyth Hermes SOL/USD collection.
- Authenticated Jupiter SOL/USDC exact-input quote collection.
- Accepted-response validation and exact raw payload persistence.
- Versioned source identities, canonical hashes, replay idempotency, and conflict detection.
- `oracle_price` and `executable_quote` contracts, taxonomy entries, normalization, freshness, confidence/quality, and provenance.
- Independent partial-source orchestration.
- Bounded HTTP timeout/retry behavior.
- Compatibility behavior for `collect:price` and `latest-price-snapshot.json`.
- Fixtures, unit/integration tests, configuration examples, source registry, and operator documentation.

### Explicitly out of scope

- Oracle/DEX divergence or any other derived feature.
- Orca pool volume, fees, TVL, liquidity, or public statistics.
- Solana network health, on-chain flow, perpetuals, macro, or news ingestion.
- Evidence-bundle assembly or publication to regime-engine.
- Research briefs, LLM interpretation, PolicyInsight synthesis, or display.
- User-specific sizing, slippage, swap preparation, transaction construction, signing, submission, or simulation.
- A durable collection-attempt/audit-log table.
- A general-purpose declarative collector framework.
- Automatic endpoint/feed discovery or automatic migration from Jupiter v1 to v2.

## Risks and concerns

### Jupiter API lifecycle

Swap v1 is quote-only but officially superseded. Swap v2 currently couples quotes to transaction or instruction construction, which is outside this repository's authority. Keeping the endpoint behind a source adapter limits migration cost, but endpoint drift is the largest external risk. Fixtures, explicit base URL config, and an operator smoke check should make drift visible.

### Pyth authentication and upgrade timing

Pyth's upgraded Hermes service requires authentication and its Core upgrade schedule is active in 2026. Hardcoding the legacy public instance would create a near-term outage. Base URL, feed ID, and key must be explicit and secrets must never enter raw request metadata.

### Taxonomy confidence terminology

Pyth confidence interval, route price impact, and repository `Confidence` are different concepts. Collapsing them into one field would destroy auditability. The normalized schemas and reason codes must keep them distinct, and quality degradation must not masquerade as missing data.

### Source time asymmetry

Pyth supplies wall-clock publish time; Jupiter supplies a slot but no source timestamp. Jupiter freshness is therefore receipt-relative and cannot prove the route existed for the entire 30-second window. The payload must state this basis explicitly.

### Identity strictness

Using Jupiter context slot may reveal multiple different route answers within one slot as conflicts. This is conservative and auditable, but could create operational noise if Jupiter legitimately recomputes routes within a slot. Metrics from initial operation should inform a versioned identity revision; the implementation must not silently broaden identity after deployment.

### Existing lifecycle edge cases

As in #22, normalized inserts and raw parse-status updates are separate repository operations. A status-update failure can leave normalized rows beside a pending raw row. Replay recovery and normalized uniqueness make this convergent, but it is not a single transaction. Cross-repository transactional refactoring is not required for this issue.

### Compatibility snapshot staleness

On Pyth-only success, the old Jupiter snapshot remains on disk. Legacy readers that ignore its timestamp may misread it as current. Documentation and aggregate warnings reduce the risk, but removal of latest-file consumers should be tracked separately.

## External references used for source-contract decisions

- [Pyth: Fetch Price Updates](https://docs.pyth.network/price-feeds/core/fetch-price-updates)
- [Pyth: Best Practices and fixed-point confidence intervals](https://docs.pyth.network/price-feeds/core/best-practices)
- [Pyth: Price Feed IDs](https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids)
- [Jupiter: Swap v1 Get Quote](https://dev.jup.ag/docs/swap/v1/get-quote)
- [Jupiter: Swap API overview and v2 migration](https://developers.jup.ag/docs/swap)
