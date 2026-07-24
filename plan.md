<!-- plan-review-required -->

# On-Chain Flow Research Collectors Pack B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect SOL/USDC-relevant whale, stablecoin, DEX-pressure, and defensible CEX-proxy facts from Helius and Birdeye; persist qualifying raw events before normalized observations; and expose auditable freshness, provenance, and confidence without inferring motive or policy.

**Architecture:** Add a provider-neutral `OnChainFlowSourcePort` with Helius and Birdeye HTTP adapters. Each provider response is converted to bounded source events, then a pure on-chain-flow domain validates, thresholds, normalizes, identifies, and enriches each event before the application layer uses the existing `ingestRawObservation` lifecycle. A multi-source job and thin CLI compose the adapters, DB repositories, run context, and documented environment configuration.

**Tech Stack:** TypeScript 5, Zod, Vitest, the existing `HttpClient`/retry abstractions, Drizzle-backed observation repositories, pnpm, ESLint, and Prettier.

---

**Assumptions and design resolution**

- Helius is the transaction-level source for `whale_transfer`, `whale_swap`, `stablecoin_flow`, and `cex_flow_proxy`; Birdeye is the windowed source for `dex_net_flow`.
- Provider endpoints return bounded factual extracts in the repository-owned source-port envelope described in Task 2. Provisioning provider accounts or translating a materially different commercial API contract is operational work, not part of this implementation.
- Thresholds are integer USDC amounts represented as decimal strings and parsed without floating-point arithmetic. Defaults are documented, but the CLI always passes explicit validated values to the job.
- Thresholding happens before raw insertion. “Raw retention” therefore means every qualifying accepted event has a separate immutable raw row; below-threshold noise and malformed events do not consume DB retention.
- Event identity never uses pagination or request time. Transaction events use provider source, transaction signature, event index, and observation kind. Windowed DEX pressure uses provider source, venue, window start/end, and observation kind.
- Provider-supplied CEX address labels are facts about attribution, not facts about motive. CEX proxies are `probabilistic`, require a minimum attribution confidence, and always carry explicit proxy/noise caveats.
- Existing JSONB observation tables and repository methods are sufficient. No database migration and no repository port/interface change is planned.
- The plan has retry paths and durable DB writes, so `plan-review-required` is present on the first line.

**Non-goals**

- No PolicyInsight, rebalance recommendation, range decision, transaction construction, or regime classification.
- No LLM narrative, motive inference, or claim that exchange deposits imply selling (or withdrawals imply buying).
- No custom Solana RPC indexer, address-label maintenance system, historical backfill, or third-party account provisioning.
- No evidence-bundle assembly/publication changes; this issue ends at persisted normalized observations.
- No mutation or deletion of existing observations, and no DB schema change.

**Affected files from repository root**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/on-chain-flow.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/confidence.test.ts`
- Create: `tests/contracts/on-chain-flow.test.ts`
- Create: `src/ports/on-chain-flow-source.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/http-helius-flow-source.ts`
- Create: `src/adapters/node/http-birdeye-flow-source.ts`
- Create: `tests/fakes/fake-on-chain-flow-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-helius-flow-source.test.ts`
- Create: `tests/adapters/node/http-birdeye-flow-source.test.ts`
- Create: `tests/fixtures/on-chain-flow.ts`
- Create: `src/domain/on-chain-flow/validate.ts`
- Create: `src/domain/on-chain-flow/threshold.ts`
- Create: `src/domain/on-chain-flow/normalize.ts`
- Create: `src/domain/on-chain-flow/identity.ts`
- Create: `src/domain/on-chain-flow/enrich.ts`
- Create: `src/domain/on-chain-flow/index.ts`
- Create: `tests/domain/on-chain-flow/validate.test.ts`
- Create: `tests/domain/on-chain-flow/threshold.test.ts`
- Create: `tests/domain/on-chain-flow/normalize.test.ts`
- Create: `tests/domain/on-chain-flow/identity.test.ts`
- Create: `tests/domain/on-chain-flow/enrich.test.ts`
- Create: `src/application/collect-on-chain-flow.ts`
- Create: `tests/application/collect-on-chain-flow.test.ts`
- Create: `src/jobs/on-chain-flow-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `tests/jobs/on-chain-flow-job.test.ts`
- Create: `scripts/collectors/on-chain-flow.ts`
- Modify: `package.json`
- Modify: `resources/sources.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`
- Create: `tests/scripts/on-chain-flow.test.ts`

## Task 1: Define on-chain flow contracts and taxonomy entries

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/on-chain-flow.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the `observationKinds` list and a new `on-chain flow registry` describe block)
- Modify: `tests/domain/taxonomy/confidence.test.ts` (only to cover the new `cex_proxy_quality_cap_applied` reason)
- Create: `tests/contracts/on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `registers deterministic on-chain transaction facts and probabilistic CEX proxies`: transfer, swap, stablecoin, and DEX entries use `on_chain_flow`; only `cex_flow_proxy` uses `probabilistic`.
- `allows only the source providers that can emit each flow kind`: Helius is allowed for transaction kinds and CEX proxy; Birdeye is allowed for DEX net flow.
- `requires explicit CEX proxy noise metadata`: the CEX payload schema cannot be represented without attribution confidence, attribution provider, proxy quality, and caveats.
- `does not provide a motive field on any normalized flow payload`: contract fixtures contain factual direction/context only.

- [ ] **Step 1: Write the failing contract and registry tests**

  Add exact tests named above. In `tests/contracts/on-chain-flow.test.ts`, use `satisfies OnChainFlowPayloadV1` fixtures and assert the discriminated union contains:
  - common fields: `schemaVersion`, `eventFamily`, `eventType`, `sourceEventId`, `observedAtUnixMs`, `amountUsdc`, `direction`, `venue`, `addressContext`, `sourceReferences`, `sourceQuality`, `freshnessContext`;
  - transaction identity: `transactionSignature`, `eventIndex`, `slot`;
  - stablecoin operation: `mint | burn | transfer`;
  - DEX window: `windowStartUnixMs`, `windowEndUnixMs`, `buyVolumeUsdc`, `sellVolumeUsdc`, `netFlowUsdc`;
  - CEX noise: `{ quality: "proxy"; attributionConfidence; attributionProvider; caveats }`.

  Run:

  ```bash
  pnpm test tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  ```

  Expected: FAIL because the new types, sources, kinds, and registry entries do not exist.

- [ ] **Step 2: Add the contracts and taxonomy**

  Extend `ObservationKind` with:

  ```ts
  | "whale_transfer"
  | "whale_swap"
  | "stablecoin_flow"
  | "dex_net_flow"
  | "cex_flow_proxy"
  ```

  Extend `Source` with `"helius-api" | "birdeye-api"` and `ConfidenceReason` with `"cex_proxy_quality_cap_applied"`.

  In `src/contracts/on-chain-flow.ts`, define `OnChainFlowDirection`, `OnChainAddressContext`, `OnChainFlowSourceQuality`, the five `*PayloadV1` interfaces, their `OnChainFlowPayloadV1` union, and:

  ```ts
  export interface OnChainFlowThresholds {
    readonly whaleTransferMinUsdc: string;
    readonly whaleSwapMinUsdc: string;
    readonly stablecoinFlowMinUsdc: string;
    readonly dexNetFlowMinUsdc: string;
    readonly cexFlowProxyMinUsdc: string;
    readonly cexMinAttributionConfidence: number;
  }
  ```

  Keep numeric money fields as canonical non-negative decimal strings, except signed `netFlowUsdc`. Do not add narrative, motive, recommendation, or policy fields. Export the file from `src/contracts/index.ts`.

- [ ] **Step 3: Register the five kinds**

  Add five version-1 entries to `observationKindRegistry`, all with `evidenceFamily: "on_chain_flow"`, 15-minute max age, 5-second skew tolerance, and `staleBehavior: "allow_context_only"`. Use `deterministic` for blockchain/window facts and `probabilistic` for `cex_flow_proxy`. Give CEX proxy greater weight to source reliability, and restrict provenance sources as described in the invariants.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  pnpm exec eslint src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts
  git commit -m "feat: define on-chain flow evidence taxonomy"
  ```

## Task 2: Add source port, Helius adapter, and Birdeye adapter

**Files:**

- Create: `src/ports/on-chain-flow-source.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/http-helius-flow-source.ts`
- Create: `src/adapters/node/http-birdeye-flow-source.ts`
- Create: `tests/fakes/fake-on-chain-flow-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-helius-flow-source.test.ts`
- Create: `tests/adapters/node/http-birdeye-flow-source.test.ts`
- Create: `tests/fixtures/on-chain-flow.ts`

**Port/interface atomicity:** This task adds `OnChainFlowSourcePort.collect` and, in the same task, adds every known implementation: `HttpHeliusFlowSource`, `HttpBirdeyeFlowSource`, and `FakeOnChainFlowSource`. Do not merge the port without all three implementations.

**Behavioral invariants to test first:**

- `Helius adapter maps transaction facts without adding motive`: accepted fields are copied into bounded source events; no narrative direction is inferred.
- `Birdeye adapter maps buy sell volumes and signed net flow for the requested window`: the request always targets `SOL/USDC`.
- `adapter rejects a malformed source envelope before application persistence`: missing stable identity, timestamps, source references, or non-finite attribution quality produces `{ kind: "malformed" }`.
- `adapter retries retryable failures up to maxAttempts`: timeout, 429, and 5xx retry with injected `RetryControl`; invalid JSON and non-retryable 4xx do not retry.
- `adapter redacts configured API keys from diagnostics`: thrown source errors never contain the secret.
- `adapter preserves an empty event list as a successful snapshot`: no-event is distinct from unavailable.

- [ ] **Step 1: Write adapter tests and fixtures**

  Define the provider-neutral port surface:

  ```ts
  export interface OnChainFlowSourceRequest {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }

  export interface OnChainFlowSourceSnapshot {
    readonly source: "helius-api" | "birdeye-api";
    readonly providerId: string;
    readonly providerRunId: string;
    readonly asOfUnixMs: number;
    readonly license: string;
    readonly retention: "bounded";
    readonly events: readonly OnChainFlowSourceEvent[];
  }

  export interface OnChainFlowSourcePort {
    collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot>;
  }
  ```

  `OnChainFlowSourceEvent` is a discriminated source-event union containing provider facts needed by Task 3. `OnChainFlowSourceError` has `timeout | network | unavailable | malformed`. Fixtures must include one event of every kind and an empty snapshot.

  Run:

  ```bash
  pnpm test tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts
  ```

  Expected: FAIL because the port and adapters do not exist.

- [ ] **Step 2: Implement the port, fake, and exports**

  Export the port from `src/ports/index.ts`. Implement a configurable fake that records requests and either returns a snapshot or throws a configured typed error; export it from `tests/fakes/index.ts`.

- [ ] **Step 3: Implement both HTTP adapters**

  Each adapter must validate `pair`, append encoded `fromUnixMs`/`toUnixMs` query parameters, authenticate using its configured header, call `HttpClient.getJson` with one HTTP attempt per outer adapter attempt, strictly validate the provider envelope and event discriminants, freeze the result, and map/redact failures. Use injected `RetryControl` and the established bounded exponential backoff pattern.

  Helius accepts transaction-backed events only. Birdeye accepts `dex_net_flow` only. A provider emitting a kind outside its allowlist is `malformed`.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts
  pnpm exec eslint src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts --max-warnings 0
  pnpm exec prettier --check src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts
  git commit -m "feat: add Helius and Birdeye flow source adapters"
  ```

## Task 3: Validate, threshold, and normalize flow facts

**Files:**

- Create: `src/domain/on-chain-flow/validate.ts`
- Create: `src/domain/on-chain-flow/threshold.ts`
- Create: `src/domain/on-chain-flow/normalize.ts`
- Create: `src/domain/on-chain-flow/index.ts`
- Create: `tests/domain/on-chain-flow/validate.test.ts`
- Create: `tests/domain/on-chain-flow/threshold.test.ts`
- Create: `tests/domain/on-chain-flow/normalize.test.ts`

**Behavioral invariants to test first:**

- `accepts canonical factual events and rejects unknown or narrative fields`: strict schemas reject motive, recommendation, NaN, negative unsigned amounts, invalid time windows, and missing references.
- `includes an event when amount equals its configured threshold`: comparisons are exact decimal comparisons, not `Number` conversions.
- `filters an event when amount is below its kind threshold`: filtered events never reach raw persistence.
- `filters CEX proxy below attribution confidence even when amount qualifies`: both gates must pass.
- `normalizes transaction direction from explicit asset deltas only`: whale swap direction is `buy_sol`, `sell_sol`, or `unknown` based on supplied SOL/USDC deltas, never address intent.
- `normalizes stablecoin mint burn and transfer as separate operations`: operation is retained exactly.
- `normalizes DEX net flow with a signed net equal to buy minus sell`: inconsistent provider net values are rejected rather than silently corrected.
- `always attaches CEX proxy noise caveats and never upgrades it to deterministic`: address attribution remains probabilistic.

- [ ] **Step 1: Write failing pure-domain tests**

  Tests must name each invariant exactly and use boundary values such as `999999.99`, `1000000`, and `1000000.01`. Include a precision case beyond JavaScript’s safe integer range.

  Run:

  ```bash
  pnpm test tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  ```

  Expected: FAIL because the domain modules do not exist.

- [ ] **Step 2: Implement strict validation and exact decimal comparison**

  Implement:

  ```ts
  acceptOnChainFlowSourceEvent(input: unknown): AcceptedOnChainFlowSourceEvent
  parseOnChainFlowThresholds(input: OnChainFlowThresholds): ParsedOnChainFlowThresholds
  qualifiesOnChainFlow(event, thresholds): boolean
  normalizeOnChainFlow(event, retrievedAtUnixMs): OnChainFlowPayloadV1
  ```

  Parse decimals into sign, digits, and scale; compare aligned integer digits without floating point. Reject scientific notation, infinities, and non-canonical leading signs. Require CEX attribution confidence in `[0, 1]`.

- [ ] **Step 3: Implement factual normalization**

  Sort/deduplicate source references and address labels. Copy provider timestamps and venue/address facts. For DEX pressure, verify exact `buyVolumeUsdc - sellVolumeUsdc === netFlowUsdc`. Build `freshnessContext` from source observation and retrieval timestamps. Do not add interpretations.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  pnpm exec eslint src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  git commit -m "feat: validate and normalize on-chain flow facts"
  ```

## Task 4: Derive stable identities and enrich normalized observations

**Files:**

- Create: `src/domain/on-chain-flow/identity.ts`
- Create: `src/domain/on-chain-flow/enrich.ts`
- Modify: `src/domain/on-chain-flow/index.ts`
- Create: `tests/domain/on-chain-flow/identity.test.ts`
- Create: `tests/domain/on-chain-flow/enrich.test.ts`

**Behavioral invariants to test first:**

- `transaction identity is stable across pagination and collection runs`: only source, kind, signature, and event index affect the source observation key.
- `different events in one transaction have different identities`: event index or kind changes the key.
- `DEX window identity changes when venue or window bounds change`: separate pressure windows cannot collide.
- `enrichment computes freshness from source time and retrieval time`: expired data is marked stale under the taxonomy policy.
- `enrichment validates raw-first provenance`: source/raw refs point to the actual raw row and allowed provider.
- `CEX confidence is capped by attribution quality and records the cap reason`: high generic provider quality cannot erase proxy uncertainty.
- `non-CEX confidence does not receive the CEX cap`: deterministic facts retain ordinary component weighting.

- [ ] **Step 1: Write failing identity and enrichment tests**

  Run:

  ```bash
  pnpm test tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  ```

  Expected: FAIL because the identity and enrichment modules do not exist.

- [ ] **Step 2: Implement stable identity**

  Export `deriveOnChainFlowObservationKey`. Canonicalize the relevant identity tuple and hash it. Explicitly exclude provider run ID, pagination cursor, fetched time, and payload hash from transaction identity so retries do not duplicate the same chain event. Use window bounds for DEX observations, which have no transaction signature.

- [ ] **Step 3: Implement enrichment**

  Export `enrichOnChainFlow`. Canonicalize the normalized payload, load its taxonomy entry, compute freshness and confidence, build/validate provenance, and return the fields needed by `NormalizedObservationInsert`. Compute completeness from required context availability. For CEX proxy, cap `sourceReliability` at `attributionConfidence`, cap final composite confidence at `0.69`, force at most `medium`, and append `cex_proxy_quality_cap_applied` when a cap changes the result.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  pnpm exec eslint src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  git commit -m "feat: identify and enrich on-chain flow observations"
  ```

## Task 5: Implement raw-first per-event collection

**Files:**

- Create: `src/application/collect-on-chain-flow.ts`
- Create: `tests/application/collect-on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `large event transitions absent to raw pending to normalized and raw parsed`: raw insert precedes normalized insert and the result is accepted.
- `identical duplicate transitions parsed to identical replay without normalized insert`: replay produces no duplicate raw or normalized row.
- `same identity with changed payload transitions to conflict and failed`: the existing immutable row is preserved.
- `below-threshold event remains absent`: neither repository is called.
- `malformed-only snapshot remains absent and returns malformed`: no raw row is written.
- `valid event followed by malformed event preserves the valid write and returns partial`: per-event failures do not roll back earlier immutable facts.
- `empty snapshot returns accepted with zero counts`: no-event is not treated as unavailable.
- `stale qualifying event is retained raw and normalized but returns degraded`: stale context is visible and cannot masquerade as fresh evidence.
- `CEX proxy below address-quality threshold remains absent`: defensibility gate runs before persistence.

- [ ] **Step 1: Write the failing application tests**

  Use the existing fake raw/normalized repositories and `FakeOnChainFlowSource`. Assert call ordering as well as returned counts/IDs.

  Run:

  ```bash
  pnpm test tests/application/collect-on-chain-flow.test.ts
  ```

  Expected: FAIL because `collectOnChainFlow` does not exist.

- [ ] **Step 2: Implement collection**

  Export:

  ```ts
  collectOnChainFlow(
    deps: CollectOnChainFlowDeps,
    context: CollectionRunContext,
    input: { source: "helius-api" | "birdeye-api"; thresholds: OnChainFlowThresholds; lookbackMs: number }
  ): Promise<OnChainFlowCollectionResult>
  ```

  Fetch one bounded window ending at `context.startedAtUnixMs`. For each returned event: validate; apply threshold/attribution gates; normalize; derive stable identity; canonicalize the accepted source event; and call `ingestRawObservation` with an enrichment callback and normalized insert callback. Process in deterministic event-identity order. Track `accepted`, `filtered`, `replayed`, and `failed` counts plus failed source IDs. Redact diagnostics. Return `accepted | partial | degraded | identical_replay | malformed | timeout | network | unavailable | failed`.

  The lifecycle is:

  ```text
  source event -> validate -> threshold gate -> raw pending
    -> normalize/enrich -> normalized insert -> raw parsed
  ```

  A validation failure occurs before `raw pending`; an enrichment/persistence failure after raw insertion marks that raw row `failed`.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-on-chain-flow.test.ts
  pnpm exec eslint src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts --max-warnings 0
  pnpm exec prettier --check src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts
  git commit -m "feat: collect raw-first on-chain flow evidence"
  ```

## Task 6: Orchestrate multi-source collection and status reduction

**Files:**

- Create: `src/jobs/on-chain-flow-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `tests/jobs/on-chain-flow-job.test.ts`

**Behavioral invariants to test first:**

- `all usable sources reduce to COMPLETE without command failure`.
- `one usable and one unavailable source reduce to PARTIAL without command failure`.
- `all unavailable sources reduce to UNAVAILABLE with command failure`.
- `zero usable sources with malformed or persistence failure reduce to FAILED with command failure`.
- `duplicate configured source names abort before collection`.
- `one run context and one threshold set are passed to both collectors`.
- `outcomes are returned in stable source-name order regardless of completion order`.

- [ ] **Step 1: Write failing job tests**

  Run:

  ```bash
  pnpm test tests/jobs/on-chain-flow-job.test.ts
  ```

  Expected: FAIL because the job does not exist.

- [ ] **Step 2: Implement job and exports**

  Export `ConfiguredOnChainFlowSource`, `OnChainFlowJobDeps`, `OnChainFlowJobResult`, `onChainFlowJob`, and `runOnChainFlowJob`. Validate exactly one Helius and one Birdeye source, create one run context, run sources independently with the same explicit thresholds/lookback, redact rejected diagnostics, sort outcomes by source, and reduce status using the truth table in the invariants. Export the public job surface from `src/jobs/index.ts`.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  pnpm test tests/jobs/on-chain-flow-job.test.ts
  pnpm exec eslint src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts --max-warnings 0
  pnpm exec prettier --check src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/jobs/on-chain-flow-job.ts src/jobs/index.ts tests/jobs/on-chain-flow-job.test.ts
  git commit -m "feat: orchestrate on-chain flow source collection"
  ```

## Task 7: Add CLI configuration and operator documentation

**Files:**

- Create: `scripts/collectors/on-chain-flow.ts`
- Modify: `package.json`
- Modify: `resources/sources.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`
- Create: `tests/scripts/on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `missing provider URL or API key fails before opening persistence`.
- `invalid negative non-decimal or unsafe threshold fails before HTTP and persistence`.
- `configured values create both adapters and pass explicit thresholds to the job`.
- `COMPLETE and PARTIAL exit zero while UNAVAILABLE and FAILED exit nonzero`.
- `provider keys are redacted from logs and close failures`.
- `database connection closes exactly once after a started run`.

- [ ] **Step 1: Write failing CLI tests**

  Test exported `runOnChainFlowCollect` through injected runtime/adapter/job factories rather than mutating real environment or opening a DB.

  Run:

  ```bash
  pnpm test tests/scripts/on-chain-flow.test.ts
  ```

  Expected: FAIL because the entrypoint does not exist.

- [ ] **Step 2: Implement the thin CLI and package command**

  Add `"collect:on-chain-flow": "tsx scripts/collectors/on-chain-flow.ts"` to `package.json`. Read and validate:

  ```text
  HELIUS_FLOW_API_URL
  HELIUS_API_KEY
  BIRDEYE_FLOW_API_URL
  BIRDEYE_API_KEY
  ON_CHAIN_WHALE_TRANSFER_MIN_USDC
  ON_CHAIN_WHALE_SWAP_MIN_USDC
  ON_CHAIN_STABLECOIN_FLOW_MIN_USDC
  ON_CHAIN_DEX_NET_FLOW_MIN_USDC
  ON_CHAIN_CEX_PROXY_MIN_USDC
  ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE
  ON_CHAIN_FLOW_LOOKBACK_MS
  ```

  Defaults: `1000000` for transaction/stablecoin/CEX thresholds, `5000000` for DEX net flow, `0.8` attribution confidence, and `900000` lookback. Instantiate both adapters, obtain persistence only after configuration validation, call `runOnChainFlowJob`, print secret-redacted JSON, map status to exit code, and close the connection in `finally`.

- [ ] **Step 3: Document source policy and operations**

  Add both sources to `resources/sources.yaml`, including authentication variables, purpose/kind allowlists, timeout/retry policy, bounded-retention requirement, attribution limitations, and threshold variables. Add architecture and runbook sections covering:
  - factual-vs-motive authority boundary;
  - per-event raw-first flow and stable identities;
  - threshold defaults and exact decimal semantics;
  - CEX proxy confidence/noise behavior;
  - environment variables, command, statuses, troubleshooting, retention, and no-event semantics.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/scripts/on-chain-flow.test.ts
  pnpm exec eslint scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts --max-warnings 0
  pnpm exec prettier --check scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts package.json resources/sources.yaml docs/architecture.md docs/operator-runbook.md
  ```

  Expected: all commands pass and documentation names every configured variable.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/collectors/on-chain-flow.ts package.json resources/sources.yaml docs/architecture.md docs/operator-runbook.md tests/scripts/on-chain-flow.test.ts
  git commit -m "feat: expose on-chain flow collector command"
  ```

**Tests added or updated**

- Contract/taxonomy: payload discriminants, required factual metadata, source allowlists, signal classes, freshness, and confidence policy.
- Adapter: provider mapping, empty response, malformed response, retry/no-retry behavior, kind allowlists, and secret redaction.
- Pure domain: strict validation, exact decimal threshold boundaries, factual normalization, DEX arithmetic, CEX quality gates, identity stability, freshness, provenance, and confidence caps.
- Application: large event, duplicate, conflict, below-threshold, malformed-only, partial persistence, no-event, stale, and low-quality CEX cases.
- Job: complete/partial/unavailable/failed reduction, duplicate configuration, shared run context, and deterministic ordering.
- CLI: configuration validation, dependency wiring, exit codes, secret redaction, and connection lifecycle.

**Validation commands**

Each task contains file-scoped acceptance commands. After all implementation tasks, the orchestrator’s dedicated validate phase may run the repository-standard gate:

```bash
pnpm verify
```

This is not an implementation task and must not be converted into one.

**Risk areas**

- Commercial provider payloads may differ from the bounded envelope assumed here; do not weaken validation to accommodate undocumented fields.
- Decimal threshold and signed net-flow arithmetic can silently lose precision if converted to JavaScript `number`.
- Transaction identity must distinguish multiple events in one signature without including pagination/run metadata.
- Per-event persistence intentionally permits partial success; status reduction must never report `COMPLETE` after a failed qualifying event.
- CEX address attribution can be stale or wrong; its explicit quality gate and confidence cap are an authority boundary, not presentation metadata.
- Retrying at both `HttpClient` and adapter layers can multiply attempts; adapters must call the client with `maxAttempts: 1`.
- Provider responses can be large; adapters must preserve bounded extracts and the configured time window rather than retaining arbitrary transaction bodies.
- DB writes are durable and append-only. Tests must prove validation/thresholding happens before insertion and conflicts never overwrite rows.

**Stop conditions**

- Abort if Helius or Birdeye cannot contractually supply stable event IDs/signatures, source timestamps, non-empty source references, or bounded-retention/license permission.
- Abort if the actual provider contract cannot distinguish transaction facts from provider interpretation, or cannot expose the attribution confidence needed for defensible CEX proxies.
- Abort if DEX buy/sell pressure cannot be denominated consistently in USDC or reconciled exactly to the signed net value.
- Abort if implementation would require mutating existing raw/normalized observations, changing DB uniqueness constraints, or bypassing `ingestRawObservation`; revise the design first.
- Abort if a requested change would publish policy, infer motive, create transactions, or cross the regime-engine authority boundary.
- Abort and split the provider into a follow-up issue if API pagination/backfill is required to meet basic collection; this plan deliberately covers one bounded window per run.

**Completion criteria**

- Every qualifying accepted event has an immutable raw row and a separately persisted normalized row with amount, direction, venue/address context, source refs, freshness, provenance, and confidence.
- Exact replays create no duplicates, changed payloads under the same chain identity conflict, and below-threshold/malformed events create no raw rows.
- All five required flow kinds are represented, with DEX pressure sourced from Birdeye and transaction flows sourced from Helius.
- CEX proxies remain probabilistic and visibly noisy; no output claims motive or policy.
- The new command, configuration, source policy, and operator behavior are documented and all task-scoped tests pass.
