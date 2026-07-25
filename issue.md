# feat: add perp and liquidation research collectors pack C

## Summary

Add perp/funding/liquidation collector support for SOL market crowding and stress context.

## Required evidence families

- funding rate;
- open interest trend;
- perp/spot basis where available;
- liquidation clusters / recent liquidation stress;
- leverage-crowding proxies from lending/perp venues where defensible.

## Scope

In scope:

- source adapters;
- raw retention and normalized observations;
- deterministic calculations where source values permit;
- confidence/freshness model;
- tests.

Out of scope:

- policy decisions;
- LLM final summarization;
- unsupported venues with unverifiable data quality.

## Acceptance criteria

- [ ] Funding, OI, basis, and liquidation observations have normalized contracts.
- [ ] Venue-specific adapters do not leak raw source shapes into the domain layer.
- [ ] Missing or stale perp data degrades explicitly.
- [ ] Evidence carries source, timestamp, freshness, confidence, and lineage.
- [ ] Tests cover rising/falling OI, positive/negative funding, stale data, and unavailable-source cases.

## Parent

Part of opsclawd/sol-usdc-clmm-intelligence#2.

## Blocked by

- opsclawd/sol-usdc-clmm-intelligence#3
- opsclawd/sol-usdc-clmm-intelligence#5
- opsclawd/sol-usdc-clmm-intelligence#6
