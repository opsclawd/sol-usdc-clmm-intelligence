# Design Doc: Ingest Core Deterministic SOL/USDC Source Data (Issue #7)

## 1. Problem and Importance

The intelligence engine for the SOL/USDC pool requires a deterministic, highly reliable set of raw facts (pool state, LP positions, oracle prices, and DEX quotes) before it can generate any derived features or AI-driven research briefs. Without a resilient source-ingestion layer, the system either operates on stale data or halts completely when a downstream API fails transiently. This ingestion layer forms the foundation of the evidence pipeline, ensuring all subsequent intelligence derivations have a verifiable, auditable trail back to the exact source bytes.

## 2. Key Design Decisions & Trade-offs

- **Store-then-Parse (Event Sourcing Pattern):**
  - _Decision:_ Raw payloads are persisted to the database (`raw_observations`) before any normalization or mapping occurs.
  - _Trade-off:_ This requires slightly more storage but guarantees we have the exact JSON bytes received. It makes debugging easier and enables retroactive re-parsing if our normalization logic changes.
- **Independent Parallel Execution:**
  - _Decision:_ Fetching from CLMM, Pyth, Jupiter, and Orca happens concurrently but is guarded independently.
  - _Trade-off:_ If one source times out, it does not block the others. A single slow API will not crash the entire pipeline run. The tradeoff is that the downstream system must handle missing data explicitly via warnings instead of assuming all data is present.
- **Idempotency via Content Hashing:**
  - _Decision:_ Raw payloads are hashed upon ingestion. If a payload's hash matches an already ingested row, the system performs a fast return (identical replay) rather than generating an error or duplicating data.
  - _Trade-off:_ Imposes a minor CPU overhead to hash payloads, but makes retries perfectly safe and prevents infinite storage bloat for data that doesn't change frequently.
- **Ports & Adapters (Hexagonal Architecture):**
  - _Decision:_ HTTP fetching, time (clock), and database repository operations are abstracted behind interfaces (ports).
  - _Trade-off:_ Increases the boilerplate needed to set up the adapters, but makes deterministic testing using fixtures trivial (e.g., passing an in-memory HTTP mock that returns static JSON).

## 3. Proposed Approach

- **Collection Use Cases:**
  - Implement distinct adapter use cases: `collectClmmBundle`, `collectPythPrice`, `collectJupiterQuote`, and `collectOrcaPoolStatistics`. Each injects dependencies like `HttpClient` and `RawObservationRepo`.
- **Orchestration (`collect-core.ts`):**
  - A core orchestrator (`collectCore`) will execute all collector functions concurrently via `Promise.all`. It wraps each individual promise in a `.catch()` that maps any error to a standardized `SourceCollectionOutcome` with warnings, ensuring partial success is supported.
- **Ingestion Utility (`ingest-raw-observation.ts`):**
  - Abstract the persist-then-parse logic into a generic `ingestRawObservation` function that accepts a raw payload, hashes it, stores it in `raw_observations`, and subsequently attempts to normalize it.
- **Conflict Handling:**
  - If a source payload for a given `sourceObservationKey` is observed with a different hash than what exists, it should throw a `RawObservationConflictError`.

## 4. Assumptions

- Drizzle ORM and the `intelligence` Postgres schema (from INT-PERSIST #5) are already set up and available.
- The evidence taxonomy types (from INT-TAXONOMY #6) (e.g., `Source`, `ParseStatus`) are fully defined.
- The `clmm-v2` API remains the source of truth, returning a canonical JSON payload that fits comfortably in memory.
- An overarching job or cron scheduler is responsible for invoking this deterministic ingestion layer periodically.

## 5. Scope

**In Scope:**

- Source adapters for `clmm-v2`, `pyth`, `jupiter`, and `orca`.
- Raw observation capture, content hashing, and database persistence.
- Normalized observation mapping to the standardized taxonomy.
- Idempotent writes, retry handling, and error/warning accumulation.
- Unit testing with static fixtures for success, timeout, and partial failure cases.

**Out of Scope:**

- Scraping or ingesting contextual news, macro-economic data, or on-chain flow / perp liquidation data.
- Calculating higher-level final derived metrics (e.g., fee APR, oracle divergence).
- Generating LLM-driven research briefs.
- Synthesizing or communicating final `PolicyInsights`.

## 6. Risks and Concerns

- **Upstream Rate Limits:** High frequency of collection could trigger HTTP 429s from Jupiter or Orca. The HTTP port should support basic retries, or the orchestrator must handle HTTP failures gracefully without panicking.
- **Payload Schema Drift:** Upstream APIs might alter their response schema without warning. `validatePayload` must aggressively mark `ParseStatus = "failed"` rather than silently ingesting `null`s or invalid objects.
- **Clock Skew / Freshness:** Oracle prices (like Pyth) must be evaluated against the current `Clock` port to ensure they aren't deeply stale. If Pyth returns a timestamp that is extremely old, the normalization step must flag the freshness as stale so derived features don't act on outdated prices.
