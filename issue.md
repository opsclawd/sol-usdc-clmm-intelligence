# feat: persist and normalize clmm-v2 SOL/USDC bundle observations

## Summary

Wire the existing clmm-v2 SOL/USDC bundle collector into the durable intelligence persistence pipeline so raw LP/pool/alert facts are captured before normalization and converted into source-independent normalized observations.

This is the first PR-sized child of #7. It covers only the existing clmm-v2 bundle source; it does not add Pyth, Jupiter, Orca public statistics, derived features, research briefs, or publishing.

## Why

The repository already consumes the read-only clmm-v2 bundle and already has raw/normalized persistence infrastructure, but the collector currently writes a latest JSON artifact rather than establishing the durable raw → normalized observation path needed by downstream deterministic feature derivation.

clmm-v2 remains the operational authority for live wallet, position, alert, and execution facts. This repository stores an append-only observational copy for analysis and lineage only.

## Required behavior

For each successful collection:

1. Fetch and validate the clmm-v2 SOL/USDC bundle.
2. Persist the exact accepted source payload in `raw_observations` before attempting normalization.
3. Compute and store the canonical payload hash and source identity needed for idempotency.
4. Normalize the relevant pool, position, range, fee/reward, alert, and data-quality facts into the common taxonomy.
5. Preserve lineage from every normalized observation to its raw observation.
6. Represent unavailable values explicitly; do not coerce missing data to zero.
7. Allow raw capture to survive a later normalization failure so the source payload remains auditable and replayable.

## Normalized fact scope

At minimum normalize the bundle facts needed for the deterministic MVP path:

- pool identity and SOL/USDC pair identity;
- current pool tick and current price;
- tick spacing, fee rate, and pool liquidity;
- position identity, lower tick, upper tick, current tick, and position liquidity;
- position range state;
- unclaimed token fees and rewards, including valuation fields when supplied;
- actionable-trigger presence and trigger/qualification context when supplied;
- bundle/source freshness and data-quality warnings.

Use existing taxonomy kinds where they fit. Extend the taxonomy only when necessary and keep any additions source-independent rather than named after clmm-v2 DTOs.

## Idempotency semantics

- Re-collecting the same source observation with an identical canonical payload must not create unnecessary duplicate raw or normalized records.
- The idempotency key and canonical hash behavior must be deterministic and documented.
- If the same source observation identity is received with different content, fail or record the conflict explicitly rather than silently overwriting prior evidence.

## Scope

In scope:

- application use case changes for clmm-v2 collection;
- raw-observation persistence;
- normalized-observation mapping and persistence;
- canonical hashing/idempotency behavior;
- replayable normalization boundary;
- partial/unavailable-data warnings;
- fixtures, unit tests, integration/adapter tests, and docs/runbook updates.

Out of scope:

- Pyth or Jupiter ingestion;
- Orca public volume/fees/TVL ingestion;
- Solana network-health ingestion;
- deterministic derived features;
- evidence-bundle assembly;
- research briefs or LLM use;
- Regime Engine publishing;
- final policy synthesis or execution authority.

## Guardrails

- Raw payload persistence precedes normalization.
- No recommendation or final-policy fields are synthesized here.
- No wallet-specific chain reads are duplicated when clmm-v2 already owns and supplies the fact.
- Missing data is `null`/unavailable plus warning metadata, never a fabricated zero.
- The existing read-only character of the clmm-v2 bundle integration remains unchanged.

## Acceptance criteria

- [ ] A successful clmm-v2 collection persists the accepted source payload in `raw_observations` before normalization runs.
- [ ] Normalized pool, position, range, fee/reward, alert, and data-quality observations are persisted using the common taxonomy.
- [ ] Every normalized record contains lineage to the originating raw observation.
- [ ] Replaying an identical observation is idempotent and does not create unnecessary duplicates.
- [ ] A conflicting replay is detected and handled deterministically.
- [ ] Missing optional facts remain explicitly unavailable and are not converted to zero.
- [ ] A normalization failure does not erase or roll back an already accepted raw observation.
- [ ] Tests cover success, identical replay, conflicting replay, malformed bundle, partial bundle data, and normalization failure after raw persistence.
- [ ] Documentation identifies clmm-v2 as the source of truth for live position/execution state and intelligence as an observational history only.

## Parent

Child of #7.

## Dependencies

The foundational work from #4, #5, and #6 must be present on the target branch before execution.
