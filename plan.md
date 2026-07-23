<!-- plan-review-required -->

# Scheduled Events and Protocol Incidents Evidence Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect bounded scheduled-event and Solana protocol-incident source records, retain them raw-first, normalize them into auditable append-only lifecycle evidence, and include only the latest eligible state of each event in SOL/USDC evidence bundles.

**Architecture:** Add two contextual observation kinds and two source ports with bounded HTTP adapters. Pure domain functions validate, normalize, classify severity, enrich metadata, and select the latest state by `(source, observationKind, sourceEventId)`; application use cases persist a bounded source snapshot before normalized rows, and bundle assembly maps selected rows to the existing `contextualEvidence.events` contract with direction fixed to `unknown`. Existing raw-observation identity semantics remain unchanged: a source snapshot uses a deterministic version key derived from the source, provider identity, source timestamp, and canonical snapshot hash, while stable event correlation is carried by `sourceEventId` in every normalized payload.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle-backed repository ports already present in the runtime, Node HTTP adapter abstractions, and the generated `evidence-bundle.v1` contract.

---

## Goal

Deliver a complete vertical slice for scheduled events and incidents:

- strict normalized contracts and taxonomy entries;
- bounded, licensed source extracts behind ports and HTTP adapters;
- raw-first persistence and append-only lifecycle updates;
- deterministic severity, confidence, provenance, freshness, and warnings;
- exact replay idempotency without overwriting event history;
- latest-state selection that excludes expired or stale evidence;
- evidence-bundle `contextualEvidence.events` population and verified lineage;
- operator commands and documentation.

## Non-goals

- General ecosystem news or regulatory-headline scraping.
- Support/resistance, on-chain flow, perp, funding, or liquidation collection.
- LLM research briefs.
- Bullish/bearish inference; bundle event direction is always `unknown`.
- Final policy synthesis, UI behavior, trading decisions, or transaction execution.
- Cross-provider entity resolution. Records are isolated by source; a provider may explicitly report disagreement, but this work does not merge events from different providers.
- New database tables or changes to the existing raw/normalized repository interfaces. Existing JSONB payloads and repository methods are sufficient.

## Assumptions and deterministic rules

- `macro-calendar-api` and `solana-status-api` are configurable bounded JSON providers, not hard-coded vendors. Their response projections contain only factual fields needed by the contracts, source references, provider reliability, confirmation evidence, and retention metadata.
- A bounded raw snapshot is safe to retain only when it declares `retentionMode: "bounded_factual_extract"` and a non-empty `license`; arbitrary response fields and long-form source text are dropped by adapters.
- `sourceEventId` is stable within one provider. The normalized correlation key is `(source, observationKind, sourceEventId)`.
- Raw snapshots remain append-only by deriving `sourceObservationKey` from the source, provider ID, provider source timestamp, and canonical snapshot hash. The same snapshot produces the same key and hash (`identical_replay`); any changed snapshot produces a new raw row and therefore cannot overwrite prior lifecycle states.
- Scheduled severity is deterministic: explicit high-impact macro releases/central-bank decisions, mainnet upgrades or maintenance, and token unlocks at or above 1% circulating supply are `HIGH`; medium-impact events or unlocks at or above 0.25% are `MEDIUM`; remaining accepted events are `LOW`. Scheduled evidence never emits `CRITICAL`.
- Incident severity is deterministic: confirmed network outage or active security exploit is `CRITICAL`; confirmed degradation or material protocol security incident is `HIGH`; scoped protocol degradation is `MEDIUM`; informational/recovery-only incidents are `LOW`.
- A provider status of `ACTIVE` or `RESOLVED` is accepted as confirmed only when at least one official or primary confirmation reference is present. Otherwise normalization emits `UNCONFIRMED` and `missing_qualifying_confirmation`.
- Scheduled defaults: `expiresAtUnixMs = max(scheduledEndUnixMs ?? scheduledStartUnixMs, scheduledStartUnixMs) + 1 hour`. Incident defaults: active evidence expires 15 minutes after `asOfUnixMs`, unconfirmed evidence after 10 minutes, and resolved evidence 1 hour after `resolvedAtUnixMs`. Provider expiry may shorten, never extend, these bounds.
- A source may provide alternate timestamps for the same source event. Differing alternates produce `conflicting_times`; incomplete required context produces `incomplete_information`; explicit provider disagreement produces `source_disagreement`.
- `CANCELLED` scheduled events and stale/expired rows remain queryable but are not current bundle evidence. A latest `RESOLVED` incident remains eligible only through its short recovery expiry. Selection never falls back to an older active row when the latest row is cancelled, resolved-and-expired, stale, or otherwise ineligible.

## Affected files

Create:

- `src/contracts/context-events.ts`
- `src/ports/scheduled-event-source.ts`
- `src/ports/protocol-incident-source.ts`
- `src/adapters/node/http-scheduled-event-source.ts`
- `src/adapters/node/http-protocol-incident-source.ts`
- `src/domain/context-events/validate.ts`
- `src/domain/context-events/identity.ts`
- `src/domain/context-events/normalize.ts`
- `src/domain/context-events/enrich.ts`
- `src/domain/context-events/select.ts`
- `src/domain/context-events/index.ts`
- `src/application/collect-context-events.ts`
- `src/application/collect-scheduled-events.ts`
- `src/application/collect-protocol-incidents.ts`
- `src/jobs/context-events-job.ts`
- `scripts/collectors/context-events.ts`
- `tests/fixtures/context-events.ts`
- `tests/fakes/fake-scheduled-event-source.ts`
- `tests/fakes/fake-protocol-incident-source.ts`
- `tests/contracts/context-events.test.ts`
- `tests/domain/context-events/validate.test.ts`
- `tests/domain/context-events/identity.test.ts`
- `tests/domain/context-events/normalize.test.ts`
- `tests/domain/context-events/enrich.test.ts`
- `tests/domain/context-events/select.test.ts`
- `tests/adapters/node/http-scheduled-event-source.test.ts`
- `tests/adapters/node/http-protocol-incident-source.test.ts`
- `tests/application/collect-context-events.test.ts`
- `tests/jobs/context-events-job.test.ts`
- `tests/scripts/context-events.test.ts`
- `tests/domain/evidence-bundle/context-events-lineage.test.ts`
- `tests/domain/evidence-bundle/context-events-assemble.test.ts`
- `tests/application/assemble-context-events.test.ts`

Modify:

- `src/contracts/taxonomy.ts`
- `src/contracts/index.ts`
- `src/ports/index.ts`
- `src/domain/taxonomy/registry.ts`
- `src/domain/evidence-bundle/lineage.ts`
- `src/domain/evidence-bundle/assemble.ts`
- `src/application/assemble-evidence-bundle.ts`
- `src/jobs/index.ts`
- `tests/fakes/index.ts`
- `tests/domain/taxonomy/registry.test.ts`
- `package.json`
- `README.md`
- `docs/architecture.md`
- `docs/operator-runbook.md`

## Behavioral invariants

The named test cases below must be written before their implementation.

1. `normalizes a first scheduled state as SCHEDULED`: no previous state plus a valid scheduled source record produces one `SCHEDULED` payload with stable identity and bounded expiry.
2. `appends a postponed scheduled state without changing sourceEventId`: a later snapshot with the same source event and a changed start time produces a distinct normalized payload linked by the same `sourceEventId`, with `postponed` and `conflicting_times` warnings where applicable.
3. `cancellation becomes the latest state and suppresses older scheduled evidence`: `SCHEDULED -> CANCELLED` keeps both rows historically but selects neither as current.
4. `unconfirmed incident cannot become active without qualifying confirmation`: `UNCONFIRMED -> provider ACTIVE` without official/primary evidence remains `UNCONFIRMED`.
5. `qualified incident activation preserves history`: `UNCONFIRMED -> ACTIVE` with official/primary evidence creates a new state and leaves the earlier row intact.
6. `incident resolution replaces active state until recovery expiry`: `ACTIVE -> RESOLVED` selects only the resolved row before expiry and none after expiry.
7. `exact source snapshot replay writes no duplicate normalized rows`: identical canonical source input returns the original raw identity and zero new normalized rows.
8. `changed snapshot appends raw and normalized history`: the same stable event identity with changed payload creates a new raw row and a new normalized row.
9. `latest ineligible state never revives older active state`: when the newest row is cancelled, stale, or expired, selection returns no older state from that identity group.
10. `unavailable source creates no absence claim`: timeout, network, rate-limit, or unavailable source outcomes persist no fabricated “no events” observation and return a degraded/unavailable result.
11. `bundle event direction is always unknown`: every scheduled or incident row maps to an event claim with `direction: "unknown"` regardless of title, severity, or status.
12. `bundle event lineage resolves to retained raw source`: each emitted event claim references a verified raw parent and source reference; missing or mismatched parents fail bundle assembly.

## Task 1: Add contextual event contracts and taxonomy entries

**Files:**

- Create: `src/contracts/context-events.ts`
- Create: `tests/contracts/context-events.test.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`

- [ ] **Step 1: Write failing contract and registry tests**

Cover strict scheduled/incident payload shapes, lifecycle enums, warnings, severity, source quality, raw provenance, required temporal fields, and rejection of unknown fields. Add registry assertions that both kinds use `macro_protocol_risk`, `contextual`, `exclude`, schema version 1, and only their matching source.

Use these exported shapes:

```ts
export type ContextEventStatus = "SCHEDULED" | "ACTIVE" | "RESOLVED" | "CANCELLED" | "UNCONFIRMED";
export type ContextEventSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ContextEventWarning =
  | "conflicting_times"
  | "source_disagreement"
  | "incomplete_information"
  | "missing_qualifying_confirmation"
  | "postponed"
  | "stale_observation";
export type ContextEventSourceQuality = {
  readonly providerId: string;
  readonly reliability: number;
  readonly completeness: "complete" | "partial";
  readonly confirmation: "official" | "primary" | "secondary" | "none";
};
export type ContextEventRawProvenance = {
  readonly sourceObservedAtUnixMs: number;
  readonly retrievedAtUnixMs: number;
  readonly retentionMode: "bounded_factual_extract";
  readonly license: string;
};
```

Define `ScheduledEventPayloadV1` and `ProtocolIncidentPayloadV1` as strict discriminated schemas/types. Both include `sourceEventId`, `eventFamily`, `eventType`, `title`, `description`, `asOfUnixMs`, `expiresAtUnixMs`, `severity`, `status`, `affectedScope`, `sourceReferences`, `sourceQuality`, `rawProvenance`, and `warnings`; scheduled events require `scheduledStartUnixMs` and nullable `scheduledEndUnixMs`, while incidents require `detectedAtUnixMs` and nullable `resolvedAtUnixMs`.

- [ ] **Step 2: Confirm the new tests fail**

Run: `pnpm exec vitest run tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Expected: FAIL because the contracts, kinds, sources, and registry entries do not exist.

- [ ] **Step 3: Implement contracts and taxonomy**

Add `"scheduled_event" | "protocol_incident"` to `ObservationKind` and `"macro-calendar-api" | "solana-status-api"` to `Source`. Export the new contracts from `src/contracts/index.ts`. Add registry entries with contextual confidence weights, source allowlists, and freshness policies of 24 hours for scheduled feed refreshes and 15 minutes for incident feed refreshes; both use source-provided expiry as the tighter bound and `staleBehavior: "exclude"`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Run: `pnpm exec eslint src/contracts/context-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/contracts/context-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts && git commit -m "feat: define contextual event evidence contracts"`

## Task 2: Implement bounded validation, identity, normalization, and enrichment

**Files:**

- Create: `src/domain/context-events/validate.ts`
- Create: `src/domain/context-events/identity.ts`
- Create: `src/domain/context-events/normalize.ts`
- Create: `src/domain/context-events/enrich.ts`
- Create: `src/domain/context-events/index.ts`
- Create: `tests/fixtures/context-events.ts`
- Create: `tests/domain/context-events/validate.test.ts`
- Create: `tests/domain/context-events/identity.test.ts`
- Create: `tests/domain/context-events/normalize.test.ts`
- Create: `tests/domain/context-events/enrich.test.ts`

- [ ] **Step 1: Write invariant-first domain tests**

Write the exact named cases:

- `normalizes a first scheduled state as SCHEDULED`
- `appends a postponed scheduled state without changing sourceEventId`
- `unconfirmed incident cannot become active without qualifying confirmation`
- `qualified incident activation preserves history`
- `incident resolution replaces active state until recovery expiry`

Also test bounded strings/arrays, strict projection, source and retrieval timestamps remaining separate, deterministic output ordering, severity threshold boundaries, token unlock and upgrade examples, time conflicts, explicit source disagreement, incomplete data, expiry defaults, confidence caps for unconfirmed/partial evidence, stale warnings, and provenance validation.

- [ ] **Step 2: Confirm domain tests fail**

Run: `pnpm exec vitest run tests/domain/context-events/validate.test.ts tests/domain/context-events/identity.test.ts tests/domain/context-events/normalize.test.ts tests/domain/context-events/enrich.test.ts`

Expected: FAIL because the context-event domain modules do not exist.

- [ ] **Step 3: Implement pure domain functions**

Provide these stable APIs:

```ts
export function acceptScheduledEventSnapshot(input: unknown): BoundedScheduledEventSnapshot;
export function acceptProtocolIncidentSnapshot(input: unknown): BoundedProtocolIncidentSnapshot;
export function deriveContextSnapshotObservationKey(input: {
  source: "macro-calendar-api" | "solana-status-api";
  providerId: string;
  sourceObservedAtUnixMs: number;
  payloadHash: string;
}): Promise<string>;
export function normalizeScheduledEvents(
  snapshot: BoundedScheduledEventSnapshot,
  retrievedAtUnixMs: number
): readonly ScheduledEventPayloadV1[];
export function normalizeProtocolIncidents(
  snapshot: BoundedProtocolIncidentSnapshot,
  retrievedAtUnixMs: number
): readonly ProtocolIncidentPayloadV1[];
export function enrichContextEvent(input: {
  payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  source: "macro-calendar-api" | "solana-status-api";
  rawId: number;
  nowMs: number;
  codeVersion: string;
  runId: string | null;
}): Promise<EnrichedContextEventObservation>;
```

Use Zod `.strict()` schemas, finite integer timestamp validation, bounded descriptions and reference arrays, sorted/deduplicated string arrays, the deterministic severity/confirmation/expiry rules above, `computeFreshness`, `computeConfidence`, `validateProvenance`, and canonical payload hashing. Do not inspect headlines for direction.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/context-events/validate.test.ts tests/domain/context-events/identity.test.ts tests/domain/context-events/normalize.test.ts tests/domain/context-events/enrich.test.ts`

Run: `pnpm exec eslint src/domain/context-events tests/domain/context-events tests/fixtures/context-events.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/context-events tests/domain/context-events tests/fixtures/context-events.ts && git commit -m "feat: normalize contextual event evidence"`

## Task 3: Add source ports and bounded HTTP adapters

**Files:**

- Create: `src/ports/scheduled-event-source.ts`
- Create: `src/ports/protocol-incident-source.ts`
- Create: `src/adapters/node/http-scheduled-event-source.ts`
- Create: `src/adapters/node/http-protocol-incident-source.ts`
- Create: `tests/fakes/fake-scheduled-event-source.ts`
- Create: `tests/fakes/fake-protocol-incident-source.ts`
- Create: `tests/adapters/node/http-scheduled-event-source.test.ts`
- Create: `tests/adapters/node/http-protocol-incident-source.test.ts`
- Modify: `src/ports/index.ts`
- Modify: `tests/fakes/index.ts`

- [ ] **Step 1: Write adapter contract tests**

Test a bounded look-ahead request for scheduled events and a Solana-mainnet request for incidents; optional bearer auth; unknown-field removal; retention/license enforcement; timeout, network, malformed, 404/429/5xx classification; secret redaction; and bounded retry timing.

Define complete port/implementation pairs in this task:

```ts
export interface ScheduledEventSourcePort {
  collect(request: {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }): Promise<ScheduledEventSourceSnapshot>;
}
export interface ProtocolIncidentSourcePort {
  collect(request: { readonly network: "solana-mainnet" }): Promise<ProtocolIncidentSourceSnapshot>;
}
```

Each snapshot exposes provider/source timestamps, reliability, license/retention metadata, bounded records, factual source references, and explicit confirmation level. Use the shared source error union `timeout | network | unavailable | malformed`.

- [ ] **Step 2: Confirm adapter tests fail**

Run: `pnpm exec vitest run tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Expected: FAIL because the ports and adapters do not exist.

- [ ] **Step 3: Implement both ports and all implementations**

Implement both adapters with the existing `HttpClient` and `RetryControl`. Use at most two attempts, one adapter-level request per attempt, exponential backoff capped at 400 ms plus injected jitter, and no retries for malformed responses or non-retryable 4xx responses. Project accepted responses into frozen bounded snapshots and redact the configured credential from diagnostics.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Run: `pnpm exec eslint src/ports/scheduled-event-source.ts src/ports/protocol-incident-source.ts src/ports/index.ts src/adapters/node/http-scheduled-event-source.ts src/adapters/node/http-protocol-incident-source.ts tests/fakes/fake-scheduled-event-source.ts tests/fakes/fake-protocol-incident-source.ts tests/fakes/index.ts tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/ports src/adapters/node/http-scheduled-event-source.ts src/adapters/node/http-protocol-incident-source.ts tests/fakes tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts && git commit -m "feat: add contextual event source adapters"`

## Task 4: Implement raw-first event collection and append-only lifecycle persistence

**Files:**

- Create: `src/application/collect-context-events.ts`
- Create: `src/application/collect-scheduled-events.ts`
- Create: `src/application/collect-protocol-incidents.ts`
- Create: `tests/application/collect-context-events.test.ts`

- [ ] **Step 1: Write persistence and lifecycle tests first**

Write the exact named cases:

- `exact source snapshot replay writes no duplicate normalized rows`
- `changed snapshot appends raw and normalized history`
- `unavailable source creates no absence claim`

Also prove that accepted bounded source data is inserted into `raw_observations` before normalized inserts, each normalized row points to its raw parent, multiple events from one snapshot insert atomically through `insertMany`, malformed snapshots write nothing, partial-invalid records retain the accepted bounded snapshot and return warnings without fabricating normalized data, and source timestamps differ from retrieval timestamps.

- [ ] **Step 2: Confirm application tests fail**

Run: `pnpm exec vitest run tests/application/collect-context-events.test.ts`

Expected: FAIL because the collection use cases do not exist.

- [ ] **Step 3: Implement the collection use cases**

Use a private generic orchestration helper plus explicit wrappers:

```ts
export async function collectScheduledEvents(
  deps: CollectScheduledEventsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult>;
export async function collectProtocolIncidents(
  deps: CollectProtocolIncidentsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult>;
```

The helper must canonicalize the bounded snapshot, derive its version-specific raw key, call `ingestRawObservation`, build/enrich all normalized candidates, and call `normalizedObservationRepo.insertMany`. Return `accepted`, `degraded`, `stale`, `identical_replay`, `malformed`, `timeout`, `network`, `unavailable`, or `failed` with counts and redacted diagnostics. A changed provider snapshot gets a changed version key and appends history; stable event linkage remains the normalized `sourceEventId`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/application/collect-context-events.test.ts`

Run: `pnpm exec eslint src/application/collect-context-events.ts src/application/collect-scheduled-events.ts src/application/collect-protocol-incidents.ts tests/application/collect-context-events.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/application/collect-context-events.ts src/application/collect-scheduled-events.ts src/application/collect-protocol-incidents.ts tests/application/collect-context-events.test.ts && git commit -m "feat: persist contextual event lifecycle history"`

## Task 5: Add the combined job and operator entrypoint

**Files:**

- Create: `src/jobs/context-events-job.ts`
- Create: `scripts/collectors/context-events.ts`
- Create: `tests/jobs/context-events-job.test.ts`
- Create: `tests/scripts/context-events.test.ts`
- Modify: `src/jobs/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write job and CLI tests**

Test one shared collection run context, independent execution of both sources, complete/partial/unavailable/failed aggregate outcomes, missing URL configuration, persistence initialization/closure, API-key redaction, and exit codes. One source succeeding while the other is unavailable is `PARTIAL` with exit code 0; both unavailable or no usable evidence is exit code 1.

- [ ] **Step 2: Confirm entrypoint tests fail**

Run: `pnpm exec vitest run tests/jobs/context-events-job.test.ts tests/scripts/context-events.test.ts`

Expected: FAIL because the job, script, and package command do not exist.

- [ ] **Step 3: Implement job and CLI wiring**

Export:

```ts
export interface ContextEventsJobDeps {
  readonly scheduledEventSource: ScheduledEventSourcePort;
  readonly protocolIncidentSource: ProtocolIncidentSourcePort;
  readonly rawObservationRepo: RawObservationRepo;
  readonly normalizedObservationRepo: NormalizedObservationRepo;
  readonly env: EnvReader;
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
}
export async function runContextEventsJob(
  deps: ContextEventsJobDeps
): Promise<ContextEventsJobResult>;
```

The script constructs both HTTP adapters from `MACRO_CALENDAR_API_URL`, optional `MACRO_CALENDAR_API_KEY`, `SOLANA_STATUS_API_URL`, and optional `SOLANA_STATUS_API_KEY`; obtains persistence from `createNodeRuntime`; prints one redacted JSON result; and closes the connection in `finally`. Add `"collect:context-events": "tsx scripts/collectors/context-events.ts"` to `package.json`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/jobs/context-events-job.test.ts tests/scripts/context-events.test.ts`

Run: `pnpm exec eslint src/jobs/context-events-job.ts src/jobs/index.ts scripts/collectors/context-events.ts tests/jobs/context-events-job.test.ts tests/scripts/context-events.test.ts`

Run: `pnpm exec prettier --check package.json`

Expected: all selected tests, lint checks, and formatting checks pass.

Commit: `git add src/jobs/context-events-job.ts src/jobs/index.ts scripts/collectors/context-events.ts tests/jobs/context-events-job.test.ts tests/scripts/context-events.test.ts package.json && git commit -m "feat: expose contextual event collection job"`

## Task 6: Select only the latest eligible lifecycle state

**Files:**

- Create: `src/domain/context-events/select.ts`
- Create: `tests/domain/context-events/select.test.ts`
- Modify: `src/domain/context-events/index.ts`

- [ ] **Step 1: Write selection invariants first**

Write the exact named cases:

- `cancellation becomes the latest state and suppresses older scheduled evidence`
- `incident resolution replaces active state until recovery expiry`
- `latest ineligible state never revives older active state`

Also cover deterministic grouping by source/kind/sourceEventId, tie-breaking by `asOfUnixMs`, then `receivedAtUnixMs`, then row ID; strict provider isolation; future observations; stale flags; expiry at the exact evaluation boundary; resolved recovery evidence; a maximum of 64 selected events; and stable output ordering.

- [ ] **Step 2: Confirm selection tests fail**

Run: `pnpm exec vitest run tests/domain/context-events/select.test.ts`

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement selection**

Export:

```ts
export interface ContextEventSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly candidates: readonly NormalizedObservationRow[];
  readonly maxItems: number;
}
export interface SelectedContextEvent {
  readonly row: NormalizedObservationRow;
  readonly payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
}
export function selectCurrentContextEvents(
  request: ContextEventSelectionRequest
): readonly SelectedContextEvent[];
```

Validate payload discriminants before grouping. Determine the latest row for every identity first, then apply eligibility; this ordering enforces the no-revival invariant. Sort selected rows by severity rank, event time, source, source event ID, and row ID before applying `maxItems`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/context-events/select.test.ts`

Run: `pnpm exec eslint src/domain/context-events/select.ts src/domain/context-events/index.ts tests/domain/context-events/select.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/context-events/select.ts src/domain/context-events/index.ts tests/domain/context-events/select.test.ts && git commit -m "feat: select current contextual event states"`

## Task 7: Extend lineage verification for contextual event rows

**Files:**

- Modify: `src/domain/evidence-bundle/lineage.ts`
- Create: `tests/domain/evidence-bundle/context-events-lineage.test.ts`

- [ ] **Step 1: Write contextual lineage tests**

Write the exact named case `bundle event lineage resolves to retained raw source`. Add failures for missing raw parent, source mismatch, payload-hash mismatch, and an unsupported contextual kind. Verify `macro-calendar-api` and `solana-status-api` map to source type `api`, and source locators use retained raw observation keys.

- [ ] **Step 2: Confirm lineage tests fail**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-lineage.test.ts`

Expected: FAIL because `VerifyEvidenceLineageInput` cannot accept contextual rows.

- [ ] **Step 3: Implement contextual lineage verification**

Modify `VerifyEvidenceLineageInput` to accept `contextualObservations: readonly NormalizedObservationRow[]`. Reuse `verifyProvenanceRef` for every selected contextual row, require its direct raw parent, include normalized/raw IDs and source references in the verified lineage, and reject any contextual row outside `scheduled_event | protocol_incident`. Preserve all existing deterministic-feature and CLMM scope verification.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-lineage.test.ts`

Run: `pnpm exec eslint src/domain/evidence-bundle/lineage.ts tests/domain/evidence-bundle/context-events-lineage.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/evidence-bundle/lineage.ts tests/domain/evidence-bundle/context-events-lineage.test.ts && git commit -m "feat: verify contextual event lineage"`

## Task 8: Populate evidence bundles with selected contextual events

**Files:**

- Modify: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/application/assemble-evidence-bundle.ts`
- Create: `tests/domain/evidence-bundle/context-events-assemble.test.ts`
- Create: `tests/application/assemble-context-events.test.ts`

- [ ] **Step 1: Write bundle mapping and orchestration tests**

Write the exact named case `bundle event direction is always unknown`. Test scheduled and protocol mappings, severity/status appearing only as factual claim text, confidence conversion to bounded basis points, canonical timestamps, expiry, source reference IDs, a 64-event cap, no stale/cancelled events, resolved recovery evidence, and empty events when feeds are unavailable.

At the application boundary, assert `normalizedRepo.listCandidates` requests exactly:

```ts
{
  sourceKinds: [
    { source: "macro-calendar-api", observationKind: "scheduled_event" },
    { source: "solana-status-api", observationKind: "protocol_incident" }
  ],
  receivedAtOrAfterUnixMs: evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000
}
```

Also prove contextual raw/normalized rows are loaded into lineage before contract validation and that contextual-query failure degrades to an empty event list plus an assembly warning instead of fabricating evidence.

- [ ] **Step 2: Confirm bundle tests fail**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Expected: FAIL because bundle assembly always emits an empty event list.

- [ ] **Step 3: Implement contextual bundle assembly**

Change `AssembleEvidenceBundleInput` to include `contextualEvents: readonly SelectedContextEvent[]`. Map each selected row to the existing generated `EventClaim`:

```ts
{
  evidenceId: `normalized-${row.id}`,
  kind: payload.kind,
  claim: `${payload.status}: ${payload.title} — ${payload.description}`,
  direction: "unknown",
  confidenceBps: Math.round(row.confidence.compositeScore * 10_000),
  observedAt: String(payload.asOfUnixMs),
  expiresAt: String(payload.expiresAtUnixMs),
  sourceReferenceIds: [`raw-${row.rawObservationId}`],
  provenanceMethod: "collected"
}
```

In `assembleEvidenceBundle`, query contextual candidates, call `selectCurrentContextEvents`, add their normalized/raw IDs to lineage loading, pass them to `verifyEvidenceLineage`, set `contextPresent` from the selected count, and pass them to domain assembly. Keep deterministic-feature availability as the gate for whether a bundle is emitted; contextual evidence supplements but never independently authorizes a bundle.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Run: `pnpm exec eslint src/domain/evidence-bundle/assemble.ts src/application/assemble-evidence-bundle.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/evidence-bundle/assemble.ts src/application/assemble-evidence-bundle.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts && git commit -m "feat: include current events in evidence bundles"`

## Task 9: Document operation, retention, and authority boundaries

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Update operator-facing documentation**

Document `pnpm collect:context-events`, all four environment variables, bounded factual-extract retention and licensing requirements, raw-first append-only lifecycle behavior, exact replay semantics, latest-state selection, exit statuses, freshness windows, source-unavailable behavior, and troubleshooting. State explicitly that severity/materiality is deterministic evidence metadata, missing feeds do not imply no risk, unconfirmed reports remain unconfirmed, event direction is always unknown, and only regime-engine can synthesize final policy.

- [ ] **Step 2: Verify and commit**

Run: `pnpm exec prettier --check README.md docs/architecture.md docs/operator-runbook.md`

Expected: all three documents are formatted.

Commit: `git add README.md docs/architecture.md docs/operator-runbook.md && git commit -m "docs: explain contextual event evidence collection"`

## Tests to add or update

- Contract validation: strict payloads, discriminants, lifecycle timestamps, status, severity, warnings, source quality, raw provenance, and unknown-field rejection.
- Taxonomy: new kinds/sources, contextual family/class, source allowlists, freshness, confidence, and stale exclusion.
- Domain validation/normalization: bounded extracts, deterministic severity, confirmation guard, postponement, cancellation, resolution, time conflicts, source disagreement, incomplete information, and expiry defaults.
- Identity: deterministic snapshot replay keys and changed-snapshot keys.
- Enrichment: freshness, confidence caps/degradation, provenance, and canonical hashes.
- HTTP adapters: bounded projection, auth, retries, failure classification, retention/license enforcement, and redaction.
- Application collection: raw-before-normalized ordering, exact replay, append-only updates, atomic normalized batches, stale/degraded results, and unavailable sources.
- Job/CLI: shared context, aggregate outcomes, env configuration, persistence lifecycle, redaction, and exit codes.
- Selection: latest-state grouping, no older-state revival, stale/expiry boundary, cancellation, resolved recovery window, source isolation, ordering, and cap.
- Bundle lineage and assembly: verified contextual parents, source references, mapping to `EventClaim`, `unknown` direction, query degradation, and 64-item cap.

## Validation commands

The implementation loop automatically runs the workspace-wide `pnpm -r typecheck` gate after each task. Each task above also names path-scoped tests and static checks. After all implementation tasks complete, the dedicated validation phase runs:

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm boundaries
pnpm verify
```

Expected: every command exits 0. `pnpm verify` is the final aggregate confirmation, not a standalone implementation task.

## Risk areas

- Retry behavior can multiply requests if the adapter accidentally delegates retries to `HttpClient`; tests must require `maxAttempts: 1` at the HTTP call and enforce the adapter's two-attempt bound.
- Raw snapshot identity must distinguish lifecycle changes while replaying byte-equivalent bounded snapshots. Including both source timestamp and canonical hash avoids overwriting history; exact duplicates remain idempotent.
- Provider timestamps may be contradictory or future-dated. Strict validation and clock-skew rules must fail closed or warn without inventing corrected times.
- Unconfirmed incidents can be accidentally promoted by trusting provider status. Confirmation evidence, not status text, controls the normalized state.
- Latest-state selection can incorrectly revive an older active row after cancellation/expiry if filtering occurs before grouping. Group/latest must happen before eligibility filtering.
- Bundle lineage currently centers deterministic features. Contextual rows must be loaded and verified without weakening CLMM scope or provenance checks.
- Generated bundle identifiers and claim lengths are bounded by the canonical contract; mapping must use stable short IDs and bounded descriptions.
- A source outage is ambiguous. It must produce a diagnostic outcome, never a normalized “no upcoming events/no incidents” fact.
- Database writes are irreversible append-only evidence. Collector tests must establish raw-first ordering, replay behavior, and no write on malformed/unavailable input.

## Stop conditions

Abort implementation and escalate instead of continuing if:

- the configured provider cannot legally permit bounded factual-extract retention or cannot supply a non-empty license/retention declaration;
- a provider cannot supply stable `sourceEventId` values or original source timestamps;
- the canonical regime-engine bundle contract no longer supports `contextualEvidence.events` with scheduled/protocol incident kinds;
- implementing append-only lifecycle history would require weakening or rewriting existing raw-observation uniqueness/history semantics;
- historical production rows would need destructive migration or mutation;
- confirmed incident status cannot be tied to official/primary qualifying references;
- tests reveal that contextual rows can bypass deterministic-feature bundle gating or become execution authority;
- API credentials or unbounded copyrighted source text appear in logs, diagnostics, or persisted metadata;
- target-branch dependencies for taxonomy, persistence, or bundle v1 are absent.

## Self-review

- Spec coverage: all issue acceptance cases map to Tasks 1–9, including scheduled macro/token unlock/upgrade fixtures, active/unconfirmed/resolved incidents, replay/update history, conflicts, stale/expired selection, unavailable sources, raw provenance, bundle output, and operator guidance.
- Placeholder scan: every task names concrete files, APIs, tests, commands, expected outcomes, and commit boundaries.
- Type consistency: the two observation kinds and sources use the same literal values across contracts, registry, ports, collectors, selector, lineage, and bundle mapping; no shared repository-port signature changes are required.
