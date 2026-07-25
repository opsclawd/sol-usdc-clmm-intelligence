# feat: ingest core deterministic SOL/USDC source data

## Summary

Implement the core deterministic source-ingestion layer for the SOL/USDC intelligence engine.

## Required sources for this issue

At minimum ingest and normalize:

- clmm-v2 SOL/USDC insight bundle for raw LP/pool/alert facts;
- Orca pool/public stats where needed for pool-level volume/fees/TVL context;
- Pyth or equivalent canonical SOL/USD oracle observations;
- Jupiter quotes / price observations for DEX comparison and route context;
- Solana network/status inputs needed for deterministic availability warnings.

## Scope

In scope:

- source adapters;
- raw-observation capture;
- normalized observation mappers;
- retry / timeout / idempotency behavior;
- data-quality warnings;
- fixtures/tests.

Out of scope:

- contextual news / macro collectors;
- on-chain-flow collectors;
- perp/liquidation collectors;
- final derived metrics;
- LLM summarization.

## Guardrails

- clmm-v2 remains the source of truth for user/position/execution facts.
- The intelligence engine may store a historical copy for analysis, but it must not become the operational authority for live LP state.
- Source adapters collect facts; they do not synthesize final recommendations.

## Acceptance criteria

- [ ] Each required source can be collected through a dedicated adapter.
- [ ] Raw responses are persisted before normalization.
- [ ] Normalized observations use the common taxonomy/freshness/provenance model.
- [ ] Partial source failures produce explicit warnings rather than fabricated values.
- [ ] The ingestion layer can run repeatedly without duplicating identical raw payloads unnecessarily.
- [ ] Tests cover success, timeout, malformed source response, and partial failure cases.

## Parent

Part of opsclawd/sol-usdc-clmm-intelligence#2.

## Blocked by

- opsclawd/sol-usdc-clmm-intelligence#3
- opsclawd/sol-usdc-clmm-intelligence#5
- opsclawd/sol-usdc-clmm-intelligence#6
- opsclawd/sol-usdc-clmm-intelligence#4
