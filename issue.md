# feat: collect scheduled market events and Solana protocol incident evidence

## Summary

Collect, retain, normalize, and deduplicate scheduled market-event and Solana protocol-incident evidence relevant to SOL/USDC risk.

This is the second PR-sized child of #9. It covers time-bounded events and operational incidents; it does not collect general ecosystem news, regulatory headlines, or support/resistance levels.

## Evidence families

### Scheduled events

At minimum support normalized evidence for relevant scheduled events such as:

- high-impact macroeconomic releases;
- central-bank decisions and speeches when materially relevant;
- known Solana upgrades or maintenance windows;
- material token unlocks or supply events;
- other pre-announced events with a defensible SOL/USDC risk relationship.

### Protocol and network incidents

At minimum support normalized evidence for:

- confirmed Solana network degradation or outage incidents;
- material protocol/security incidents affecting Solana market or execution conditions;
- incident resolution/recovery updates;
- explicit unknown/unconfirmed states while an incident is still developing.

## Required normalized event contract

Each event/incident record must include at minimum:

- stable source/event identity;
- event family and event type;
- title/short factual description;
- scheduled start/end or detected/resolved times as applicable;
- `asOf` and `expiresAt`;
- severity/materiality classification derived from documented deterministic rules;
- confidence and source-quality metadata;
- affected ecosystem/protocol scope;
- source references and raw provenance;
- status such as `SCHEDULED`, `ACTIVE`, `RESOLVED`, `CANCELLED`, or `UNCONFIRMED` where applicable;
- warnings for conflicting times, source disagreement, or incomplete information.

Severity is evidence metadata, not a final trading recommendation.

## Source and retention behavior

- Collect through source adapters behind ports.
- Persist accepted raw observations or compliant bounded source extracts before normalization.
- Preserve original source timestamps and retrieval timestamps separately.
- Respect source licensing and retention constraints.
- Never convert an unconfirmed report into a confirmed incident without qualifying source evidence.

## Deduplication and lifecycle

- Deduplicate exact replays idempotently.
- Correlate updates to the same scheduled event or incident using deterministic identity rules.
- Preserve state transitions and history rather than overwriting the original event.
- Handle postponements, cancellations, corrections, and incident resolution explicitly.
- Expired events remain historically queryable but must not be selected as current evidence.

## Scope

In scope:

- macro/event-calendar adapters;
- Solana status/protocol-incident adapters;
- normalized event/incident contracts and taxonomy additions;
- raw retention, provenance, freshness, confidence, lifecycle, and deduplication;
- persistence, fixtures, tests, and operator documentation.

Out of scope:

- general ecosystem news or regulatory-headline collection;
- support/resistance evidence;
- on-chain flow, perp, funding, or liquidation evidence;
- LLM research-brief generation;
- final policy synthesis, UI, or execution behavior.

## Guardrails

- Scheduled events and incidents are contextual risk evidence, not execution authority.
- Unconfirmed reports remain explicitly unconfirmed.
- Missing event feeds do not imply no upcoming risk.
- Do not assign market direction from an event headline in this issue.

## Acceptance criteria

- [ ] Scheduled events and protocol incidents have strict normalized contracts with explicit lifecycle states and timestamps.
- [ ] Accepted source observations are retained before normalization with complete source provenance.
- [ ] Exact replays are idempotent and updates to one event/incident remain linked without overwriting history.
- [ ] Postponed, cancelled, active, resolved, unconfirmed, stale, and conflicting-source cases are represented explicitly.
- [ ] Tests cover scheduled events, token unlocks/upgrades, active incidents, incident resolution, duplicate updates, conflicting times, stale events, and unavailable sources.
- [ ] Documentation states that severity/materiality is deterministic evidence metadata, not a final recommendation.

## Parent

Child of #9.

## Dependencies

The architecture, persistence, and taxonomy foundations from #3, #5, and #6 must be present on the target branch.
