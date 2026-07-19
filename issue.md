# feat: ingest and normalize Pyth and Jupiter SOL/USDC price observations

## Summary

Add durable Pyth and Jupiter source ingestion for SOL/USDC price-quality evidence. Persist each accepted source response before normalization, then produce source-independent oracle and executable-quote observations with freshness, confidence, provenance, and explicit partial-failure semantics.

This is a PR-sized child of #7. It covers only Pyth and Jupiter price observations; it does not add Orca public pool statistics, derived features, evidence-bundle assembly, research briefs, or publishing.

## Why

The deterministic MVP needs two independently sourced price views:

- a canonical SOL/USD oracle observation with its confidence interval;
- a DEX/executable-route observation that can be compared with the oracle.

The existing Jupiter collector is not sufficient as a durable evidence source because downstream features require raw retention, normalized contracts, time-bounded freshness, and exact provenance. Pyth confidence data is also required so the system can distinguish a reliable oracle value from a wide-confidence observation.

## Required sources

### Pyth or canonical equivalent

Collect at minimum:

- SOL/USD price;
- confidence interval/width;
- source publish time;
- source/feed identity;
- any source status needed to determine whether the observation is valid or stale.

Pyth is the preferred implementation unless the repository already has an explicitly approved canonical equivalent. Do not silently substitute a generic token-price API without recording the design decision.

### Jupiter

Collect an executable SOL/USDC quote or equivalent route observation suitable for deterministic price comparison. Record at minimum:

- input/output mint identities;
- exact input amount used for the probe quote;
- quoted output amount;
- implied SOL/USDC price;
- price impact or route metadata when provided;
- quote/context slot or source timestamp when provided;
- route availability warnings.

The quote amount must be deterministic and documented. This adapter supplies generic market evidence only; it is not authority for a user-specific execution transaction.

## Required behavior

For each source independently:

1. Perform the source request with explicit timeout behavior.
2. Validate the transport envelope and required source fields.
3. Persist the exact accepted payload in `raw_observations` before normalization.
4. Normalize the accepted payload into the common taxonomy.
5. Preserve lineage from normalized observations to raw payloads.
6. Apply source-specific freshness and confidence rules from the taxonomy.
7. Make repeated identical observations idempotent.
8. Surface malformed, unavailable, stale, or partial source results explicitly.

The collection use case must support partial success:

- Pyth success + Jupiter failure persists Pyth evidence and records Jupiter as unavailable.
- Jupiter success + Pyth failure persists Jupiter evidence and records Pyth as unavailable.
- One source failure must not fabricate the other source or roll back already accepted raw data.

## Normalized observation scope

At minimum produce normalized facts equivalent to:

- oracle SOL/USD price;
- oracle confidence interval/width;
- oracle publish/as-of time;
- Jupiter SOL/USDC executable quote;
- Jupiter implied SOL/USDC price;
- route availability and relevant generic route warnings.

Use source-independent observation names. Source identity belongs in provenance, not in the semantic observation kind.

## Idempotency and conflicts

- Identical replays must not create unnecessary duplicate raw or normalized records.
- Canonical hashing and source observation identity must be deterministic and documented.
- Conflicting content for the same source observation identity must be detected rather than silently overwritten.

## Scope

In scope:

- Pyth HTTP/RPC adapter or approved canonical-oracle adapter;
- Jupiter executable-quote adapter;
- application collection use cases;
- raw and normalized persistence;
- timeout/retry behavior appropriate for collection;
- provenance, freshness, and confidence mapping;
- partial-source result aggregation;
- fixtures, tests, config, and operator documentation.

Out of scope:

- Orca volume, fee, TVL, or liquidity statistics;
- Solana network-health ingestion;
- user-specific swap preparation or execution quoting;
- deterministic derived-feature calculations;
- evidence-bundle assembly;
- LLM use, policy synthesis, or app display.

## Guardrails

- Raw payloads are persisted before normalization.
- Numerical comparison features are not calculated in this issue.
- Jupiter observations remain generic research evidence and cannot override clmm-v2 execution slippage, balance, or transaction-safety checks.
- Missing values remain unavailable with warning metadata; they are never represented as zero.
- Retry behavior must be bounded and must not create duplicate observations.

## Acceptance criteria

- [ ] Pyth/canonical-oracle responses are persisted raw and normalized with price, confidence, source time, freshness, and provenance.
- [ ] Jupiter executable-quote responses are persisted raw and normalized with exact probe amount, output amount, implied price, route context, freshness, and provenance.
- [ ] Raw persistence occurs before normalization for both sources.
- [ ] Identical replays are idempotent and conflicting replays are handled deterministically.
- [ ] Pyth-only and Jupiter-only partial-success scenarios preserve accepted evidence and emit explicit warnings for the failed source.
- [ ] Timeout, malformed response, stale oracle, unavailable route, and source failure cases are covered by tests.
- [ ] No derived oracle/DEX divergence feature is implemented in this issue.
- [ ] Documentation states that Jupiter route evidence is generic context, not user-specific execution authority.

## Parent

Child of #7.

## Blocked by

- #22

The implementation should reuse the raw-before-normalized persistence and idempotency patterns established by #22 rather than creating a second ingestion architecture.
