# feat: add on-chain flow research collectors pack B

## Summary

Add the on-chain-flow collector pack for SOL/USDC-relevant market pressure context.

## Required evidence families

- whale transfers;
- whale swaps;
- stablecoin mint/burn and transfer flows;
- DEX net flow / SOL buy-sell pressure;
- CEX flow proxies where address-quality is defensible.

## Scope

In scope:

- source adapters / indexer integrations;
- raw retention and normalization;
- thresholding / deduplication;
- provenance and source-quality handling;
- tests.

Out of scope:

- policy decisions;
- speculative motive inference as deterministic truth;
- LLM final summarization.

## Guardrails

- A transfer is a fact; motive is an interpretation.
- Keep transfer/swap observations separate from LLM narrative.
- CEX-proxy signals must carry explicit noise/confidence metadata.

## Acceptance criteria

- [ ] The system stores raw on-chain flow observations and normalized events separately.
- [ ] Deterministic facts and speculative interpretations are not conflated.
- [ ] Evidence includes amount, direction, venue/address context where available, source refs, freshness, and confidence.
- [ ] Thresholds are configurable and documented.
- [ ] Tests cover large event, duplicate event, malformed event, and no-event cases.

## Parent

Part of opsclawd/sol-usdc-clmm-intelligence#2.

## Blocked by

- opsclawd/sol-usdc-clmm-intelligence#3
- opsclawd/sol-usdc-clmm-intelligence#5
- opsclawd/sol-usdc-clmm-intelligence#6
