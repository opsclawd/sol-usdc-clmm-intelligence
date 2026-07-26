# feat: generate schema-constrained research briefs from evidence bundles

## Summary

Use an LLM over bounded, structured evidence bundles to produce compact research briefs for Regime Engine.

## Core rule

The LLM summarizes and explains evidence. It does not invent deterministic metrics and does not make the final policy decision.

## Required brief output

Define a schema-constrained `ResearchBrief` that includes at least:

- pair;
- asOf / expiresAt;
- source bundle refs;
- headline;
- key changes since prior brief;
- supports-current-regime assessment where applicable;
- major risks;
- confidence;
- source refs;
- warnings / missing evidence;
- prompt version;
- model/provider metadata.

## Scope

In scope:

- prompt templates;
- JSON/schema-constrained output;
- bounded evidence selection;
- prompt/model versioning;
- persistence of inputs and outputs;
- regression fixtures and tests;
- fallback behavior on invalid model output.

Out of scope:

- policy synthesis;
- direct user-facing copy;
- raw data collection.

## Acceptance criteria

- [ ] The LLM receives bounded structured evidence, not an uncontrolled raw data dump.
- [ ] The output is schema-validated before persistence/publication.
- [ ] Prompt version and model/provider metadata are persisted.
- [ ] Unsupported or missing inputs are called out explicitly in the brief.
- [ ] Invalid LLM output fails closed or enters a clear degraded state.
- [ ] Regression fixtures cover at least calm, trending, stressed, and sparse-data scenarios.

## Parent

Part of opsclawd/sol-usdc-clmm-intelligence#2.

## Blocked by

- opsclawd/sol-usdc-clmm-intelligence#8
- opsclawd/sol-usdc-clmm-intelligence#9
- opsclawd/sol-usdc-clmm-intelligence#10
- opsclawd/sol-usdc-clmm-intelligence#11
