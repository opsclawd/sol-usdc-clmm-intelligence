# feat: collect and normalize SOL/USDC support-resistance evidence

## Summary

Add the first PR-sized contextual-evidence slice: collect, retain, normalize, and deduplicate SOL/USDC support/resistance evidence with explicit timeframe, freshness, confidence, source references, and thesis lineage.

This is the first child of #9. It is intentionally separate from scheduled events, protocol incidents, ecosystem news, and regulatory headlines.

## Correct boundary

This repository records bounded support/resistance evidence. It does not author the canonical user-facing `PolicyInsight`, qualify execution triggers, or override clmm-v2 safety rules.

Support/resistance evidence is contextual and probabilistic. It must remain distinguishable from deterministic pool, oracle, and position facts.

## Required normalized evidence

Each normalized support/resistance item must include at minimum:

- pair (`SOL/USDC`);
- evidence side (`SUPPORT`, `RESISTANCE`, or a documented zone type);
- level or zone bounds with explicit `USDC_PER_SOL` units;
- timeframe/horizon;
- thesis or reason codes explaining the level source;
- `asOf` and `expiresAt`;
- confidence and source-quality metadata;
- source references;
- provenance linking to retained raw material;
- invalidation conditions when the source supplies them;
- warnings for ambiguity, disagreement, or missing data.

Use a schema that can represent both point levels and bounded zones without converting one into the other silently.

## Source and raw-retention behavior

- Use source adapters behind ports.
- Retain the accepted raw source material or bounded source extract needed for audit and replay.
- Respect source licensing and retention constraints; store references and compliant extracts rather than copying prohibited full content.
- Normalize only claims supported by the retained material.
- Do not infer exact numeric levels from prose that does not provide them.

## Deduplication and conflict handling

- Collapse exact replays idempotently.
- Group materially equivalent levels from the same source/run where deterministic rules can establish equivalence.
- Preserve distinct sources and disagreements rather than merging them into false consensus.
- Record supersession/expiry explicitly; do not overwrite historical evidence.

## Scope

In scope:

- support/resistance source adapters;
- raw retention/source references;
- normalized contracts and taxonomy additions;
- freshness, confidence, provenance, deduplication, and conflict rules;
- persistence, fixtures, tests, and documentation.

Out of scope:

- macro calendars or scheduled-event collection;
- Solana protocol incidents;
- ecosystem news or regulatory headlines;
- on-chain flow or perp/liquidation evidence;
- LLM research-brief generation;
- final policy synthesis or UI changes.

## Guardrails

- Contextual levels cannot silently override deterministic hard guards.
- Missing levels remain unavailable; do not fabricate technical levels.
- Confidence cannot exceed the quality and freshness of the source material.
- Keep raw evidence, normalized claims, and later policy interpretation separate.

## Acceptance criteria

- [ ] Support and resistance points/zones have a strict normalized contract with explicit units and timeframe.
- [ ] Accepted source material is retained or referenced with compliant audit provenance.
- [ ] Exact replays are idempotent and materially distinct sources remain independently traceable.
- [ ] Stale, expired, ambiguous, conflicting, and missing-level cases are represented explicitly.
- [ ] Tests cover point levels, zones, duplicate evidence, conflicting sources, stale evidence, malformed levels, and unavailable sources.
- [ ] Documentation states that support/resistance is contextual evidence, not execution authority.

## Parent

Child of #9.

## Dependencies

The architecture, persistence, and taxonomy foundations from #3, #5, and #6 must be present on the target branch.
