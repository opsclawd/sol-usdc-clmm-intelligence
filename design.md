# Design: Scheduled Events and Protocol Incidents Evidence Collection

## 1. The Problem Being Solved and Why It Matters

The SOL/USDC CLMM Intelligence agent currently lacks structured context regarding exogenous time-bounded market events (e.g., macro releases, token unlocks) and operational incidents (e.g., Solana network degradation, protocol hacks). Without this, the downstream `regime-engine` cannot defensively adjust policies (e.g., pausing liquidity provision or widening spreads) around known high-volatility windows or network instability. This issue introduces the deterministic collection, normalization, and lifecycle management of these contextual risk events so they can be bundled as structured evidence.

## 2. Key Design Decisions and Trade-offs Considered

**Decision 1: Unified vs. Distinct Normalized Contracts**

- _Option A (Unified):_ A single `NormalizedEvent` contract handling both macro events and protocol incidents.
- _Option B (Distinct):_ Separate payload contracts (`ScheduledEventPayload` and `ProtocolIncidentPayload`) mapped to separate `ObservationKind`s.
- _Trade-off:_ Option A reduces schema duplication for common fields like `status`, `severity`, and `title`. Option B allows strict typing for domain-specific fields (e.g., `scheduledStart` vs `detectedAt`).
- _Selected Approach:_ **Distinct payload types with shared standard metadata**. The taxonomy will add two new `ObservationKind`s: `scheduled_event` and `protocol_incident`. The payload schemas will share common fields (status, severity, references) but strictly require their respective temporal fields.

**Decision 2: State Lifecycle and Deduplication**

- _Option A (Mutable State):_ Update existing normalized rows in the DB when an incident resolves or an event is postponed.
- _Option B (Append-Only):_ Insert new `normalized_observations` for every state change with the same stable source identity, using `receivedAtUnixMs` to establish the current state.
- _Trade-off:_ Mutable state is easier to query but destroys point-in-time historical reconstruction. Append-only is required by the intelligence pipeline's immutable architecture.
- _Selected Approach:_ **Append-Only with Deterministic Identity**. We will correlate updates using a stable `sourceEventId` provided by the source. The latest observation per `sourceEventId` represents the current state. Exact replays will be deduplicated idempotently by comparing the `payloadHash`.

**Decision 3: Severity and Confidence Scoring**

- _Trade-off:_ Hardcoding severity rules into the collector vs. passing raw severity from sources.
- _Selected Approach:_ Sources will map their internal severities to a standard deterministic classification (e.g., `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`). The Intelligence agent does NOT infer market direction, only the materiality of the event.

## 3. Proposed Approach with Rationale

1. **Taxonomy Additions (`src/contracts/taxonomy.ts`)**:
   - Add new `ObservationKind`s: `"scheduled_event" | "protocol_incident"`.
   - Add new `Source`s: `"macro-calendar-api" | "solana-status-api"` (or generalized equivalent names).
   - Both will map to `EvidenceFamily = "macro_protocol_risk"` and `SignalClass = "contextual"`.

2. **Normalized Contracts (`src/contracts/normalized-events.ts`)**:
   - Create standard TypeScript interfaces for `ScheduledEventPayload` and `ProtocolIncidentPayload`.
   - Required fields will include: `sourceEventId`, `eventType`, `title`, `description`, `status` (`SCHEDULED`, `ACTIVE`, `RESOLVED`, `CANCELLED`, `UNCONFIRMED`), `severity`, `affectedScope`, and `warnings`.
   - Temporal fields: `scheduledStart` / `scheduledEnd` for events; `detectedAt` / `resolvedAt` for incidents.

3. **Lifecycle & Persistence**:
   - Adapters fetch data periodically.
   - Raw observations are persisted to `raw_observations`.
   - The normalizer maps raw data to the new payload types, generating a stable `payloadHash`.
   - If the hash and source match an existing record (exact replay), the insert is skipped (idempotent).
   - If a status change occurs (e.g., `ACTIVE` -> `RESOLVED`), a new `normalized_observations` row is inserted. Expired events will stop being selected as active evidence based on their `expiresAt` or `validUntilUnixMs` values.

## 4. Assumptions Made

- **Adapter Implementations**: Specific external APIs (e.g., ForexFactory, Solana Status RSS) are not strictly mandated by this design phase, but the system assumes the existence of adapter interfaces that can provide this data. Mock adapters will be implemented for tests if live ones aren't defined yet.
- **Drizzle Schema**: The existing `raw_observations` and `normalized_observations` tables use JSONB for `payload`. We do not need new database tables, just new Zod schemas and TypeScript interfaces for the JSONB payload.
- **Evidence Bundle Integration**: The `regime-engine` expects these events as part of the standard `v1/evidence/sol-usdc` payload under a contextual section; we will supply this via our standard normalization flow.

## 5. Scope

**In Scope**:

- Definition of normalized event/incident contracts.
- Taxonomy additions (`ObservationKind`, `Source`).
- Normalizer logic handling lifecycle (deduplication, state transitions).
- Zod schema validation for payloads.
- Persistence integration (inserting to JSONB payloads).
- Comprehensive unit tests covering status transitions, stale events, and exact replays.
- Operator documentation updates.

**Out of Scope**:

- General ecosystem news or regulatory headline scraping.
- Evaluating the actual directional impact (bullish/bearish) of an event.
- Final policy synthesis, UI, or execution behavior.
- On-chain flow, perp, funding, or liquidation evidence (handled separately).

## 6. Risks or Concerns Identified

- **Stale/Stuck State**: If an incident adapter fails to fetch the `RESOLVED` state (e.g., source goes offline), an incident might remain permanently `ACTIVE`. The normalizer should enforce an `expiresAt` or rely on `FreshnessPolicy` to degrade/exclude events that haven't received an update within a reasonable timeout.
- **Conflicting Sources**: Different sources might report different times for the same macro event. The normalizer needs to tag these with a `warning` in the payload if correlation is attempted across sources, or simply rely on strict source isolation to avoid cross-source contamination.
- **Event Mutability vs Append-Only**: Guaranteeing that the latest row accurately overrides earlier states without confusing downstream consumers relies on strict querying rules. Downstream bundle generation must use `PARTITION BY sourceEventId ORDER BY receivedAtUnixMs DESC` (or equivalent) to only surface the most recent state.
