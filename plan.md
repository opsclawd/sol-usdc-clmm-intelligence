<!-- plan-review-required -->

# Deterministic Solana Network Status Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issue #7’s deterministic core-ingestion acceptance criteria by adding raw-first Solana RPC health observations and availability warnings to the existing CLMM, Pyth, Jupiter, and Orca core collection run.

**Architecture:** Preserve the existing four collectors and shared `ingestRawObservation` lifecycle. Add a deterministic `network_status` taxonomy entry and pure Solana JSON-RPC batch validation/normalization, then collect `getHealth` plus `getSlot` through the existing HTTP/retry/repository ports. Extend the guarded core coordinator from four to five leaves so a Solana outage is explicit but never rolls back usable sibling evidence.

**Tech Stack:** TypeScript 5, Vitest, the existing `HttpClient`, `RetryControl`, `RawObservationRepo`, and `NormalizedObservationRepo` ports, Zod-free strict domain validation consistent with the Orca domain, pnpm, ESLint, Prettier, and dependency-cruiser.

---

## Current-state resolution and assumptions

- `collectClmmBundle`, `collectPythPrice`, `collectJupiterQuote`, `collectOrcaPoolStatistics`, `ingestRawObservation`, content hashing, repository idempotency, HTTP timeout/retry support for GET sources, and four-leaf partial-failure orchestration already exist on this branch. Reimplementing them is a non-goal.
- The issue still explicitly requires “Solana network/status inputs needed for deterministic availability warnings.” Current `solana-status-api` protocol incidents are contextual reports, not a live deterministic availability observation. This plan adds a distinct `solana-rpc` source.
- `SOLANA_RPC_URL` points to one operator-selected mainnet RPC endpoint. This is endpoint health evidence, not proof that every Solana validator or RPC provider is healthy.
- One JSON-RPC batch request contains `getHealth` with id `"health"` and `getSlot` with id `"slot"`. Responses are correlated by id, never by array order.
- The repository’s established “raw” representation is canonical JSON (`payloadCanonical`), not original whitespace-preserving HTTP bytes. This plan follows that existing persistence contract.
- A successful HTTP 2xx body is inserted with `parseStatus: "pending"` before strict JSON-RPC validation or normalization. Transport failures and non-2xx responses have no accepted observation body and therefore do not create raw rows.
- `getHealth: "ok"` is healthy. JSON-RPC error `-32005` with a non-negative safe-integer `numSlotsBehind` is a valid degraded observation. Other health errors are unavailable/malformed outcomes and never fabricate a healthy value.
- A failed `getSlot` alongside valid health is retained as usable degraded health evidence with `slot_unavailable`; it does not erase the valid `getHealth` fact.
- Retries are leaf-local: at most two total identical POST attempts, retrying only timeout/network failures and HTTP 408, 429, or 5xx. There is no coordinator retry and no cross-source transaction.
- No DB migration or repository-port method is required because both observation tables already store extensible JSON payloads and the required insert/query methods already exist.
- This plan contains a bounded retry loop and irreversible database inserts, so `plan-review-required` is present on the first line.

## Non-goals

- Do not alter the semantics or payload contracts of the existing CLMM, Pyth, Jupiter, or Orca collectors.
- Do not replace the contextual `protocol_incident` collector or merge incident narratives into deterministic RPC status.
- Do not build RPC fan-out, quorum health, validator monitoring, transaction simulation, or signing/execution behavior.
- Do not calculate derived features, regimes, recommendations, PolicyInsights, research briefs, or evidence publication.
- Do not persist API keys, authorization headers, credential-bearing RPC paths, or unredacted endpoint URLs in metadata or diagnostics.
- Do not add a new HTTP, retry, clock, or repository port method.

## Affected files from repository root

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/normalized-network-status.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Create: `src/domain/network-status/solana-rpc.ts`
- Create: `src/domain/network-status/identity.ts`
- Create: `src/domain/network-status/normalize.ts`
- Create: `src/domain/network-status/enrich.ts`
- Create: `src/domain/network-status/index.ts`
- Create: `tests/fixtures/solana-network-status.ts`
- Create: `tests/domain/network-status/solana-rpc.test.ts`
- Create: `tests/domain/network-status/identity.test.ts`
- Create: `tests/domain/network-status/normalize.test.ts`
- Create: `tests/domain/network-status/enrich.test.ts`
- Create: `src/application/collect-solana-network-status.ts`
- Create: `tests/application/collect-solana-network-status.test.ts`
- Modify: `src/contracts/collection-run.ts`
- Modify: `src/application/collect-core.ts`
- Modify: `src/application/source-outcome.ts`
- Modify: `src/domain/core-collection/reduce.ts`
- Modify: `src/jobs/core-collection-job.ts`
- Modify: `scripts/collectors/core-collection.ts`
- Modify: `tests/application/collect-core.test.ts`
- Modify: `tests/application/source-outcome.test.ts`
- Modify: `tests/domain/core-collection/reduce.test.ts`
- Modify: `tests/scripts/core-collection.test.ts`
- Modify: `.env.example`
- Modify: `resources/sources.yaml`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

## Behavioral invariants

The named invariants below are test names to write before implementation. They cover the stateful and logic-heavy behavior that must not be left implicit.

1. `accepts healthy getHealth and getSlot responses regardless of batch order`: ids, not array positions, determine meaning.
2. `accepts Solana node-behind error minus 32005 as degraded health evidence`: a recognized unhealthy response is a fact, not a malformed payload.
3. `rejects duplicate missing unknown or mismatched JSON-RPC response ids`: ambiguous batches never normalize.
4. `normalizes a healthy batch without warnings`: health is `ok`, slot is retained, and slots-behind is null.
5. `normalizes node-behind and missing slot as explicit sorted warnings`: health is `behind`; no healthy or slot value is invented.
6. `derives stable identity from network and collection instant only`: replaying the same run targets the same raw identity regardless of response member order.
7. `persists a 2xx response before validating and normalizing it`: the event order is raw insert, normalized insert, then parsed status.
8. `marks a persisted malformed RPC batch failed without normalized rows`: schema drift remains auditable and unusable.
9. `replays identical network status without duplicate raw or normalized rows`: parsed replays recover the linked normalized status.
10. `rejects a same-identity different-payload replay as conflict`: existing raw and normalized evidence remain unchanged.
11. `retries timeout network 408 429 and 5xx at most twice with the identical batch`: retry input and credential handling do not drift.
12. `does not retry permanent 4xx or malformed successful bodies`: non-retryable failures stop immediately.
13. `returns degraded usable evidence for node-behind or slot-unavailable status`: warnings are explicit while the health fact remains usable.
14. `never exposes RPC credentials or credential-bearing paths in metadata or diagnostics`: only a safe host label and method names are retained.
15. `starts all five leaves before awaiting and invokes each exactly once`: the new source preserves independent parallel execution.
16. `preserves four-source evidence when Solana RPC is unavailable`: overall status is `PARTIAL`, no sibling result is rewritten, and the command remains successful.
17. `returns COMPLETE only when all five sources contribute fresh usable evidence`: the result shape and count reflect the fifth source.
18. `maps unavailable Solana status to an explicit aggregate warning without fabricating evidence`: absence is visible without a normalized placeholder.
19. `orders Solana warnings after the four existing source groups`: output is deterministic regardless of promise completion order.

## Task 1: Define deterministic network status contracts and taxonomy

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/normalized-network-status.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the observation-kind parity list and a new `network_status registry` describe block)
- Modify: `tests/domain/taxonomy/validation.test.ts` (only the `runtime taxonomy parity` describe block)

**Behavioral invariants to test first:**

- `registers network status as deterministic execution safety evidence`
- `allows only solana rpc provenance for network status`
- `parses network status and solana rpc taxonomy literals`
- `requires warnings instead of nullable fabricated health values`

- [ ] **Step 1: Write the failing taxonomy and contract assertions**

  Extend the observation-kind parity fixture with `"network_status"`. Add a focused registry describe block that asserts deterministic `execution_safety`, a 60-second maximum age, 5-second skew tolerance, `staleBehavior: "exclude"`, schema version 1, and only `"solana-rpc"` provenance. In runtime parity, assert `parseObservationKind("network_status")` and `parseSource("solana-rpc")`.

  Use a compile-checked fixture with this exact public shape:

  ```ts
  const healthy: NetworkStatusPayloadV1 = {
    kind: "network_status",
    schemaVersion: 1,
    network: "solana-mainnet-beta",
    observedAtUnixMs: 1715342400000,
    health: "ok",
    slot: 260000000,
    slotsBehind: null,
    warnings: []
  };
  ```

  Run:

  ```bash
  pnpm test tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  ```

  Expected: FAIL because the new literals, payload contract, registry entry, and runtime validation entries do not exist.

- [ ] **Step 2: Add the exported payload and taxonomy literals**

  Add `"network_status"` to `ObservationKind` and `"solana-rpc"` to `Source`. Create and export:

  ```ts
  export type NetworkStatusWarning = "node_behind" | "slot_unavailable";

  export interface NetworkStatusPayloadV1 {
    readonly kind: "network_status";
    readonly schemaVersion: 1;
    readonly network: "solana-mainnet-beta";
    readonly observedAtUnixMs: number;
    readonly health: "ok" | "behind";
    readonly slot: number | null;
    readonly slotsBehind: number | null;
    readonly warnings: readonly NetworkStatusWarning[];
  }
  ```

  `health` is never nullable and never contains `"unknown"` or `"unavailable"`; absence stays in the source outcome rather than becoming fabricated evidence.

- [ ] **Step 3: Register and validate the new taxonomy values**

  Add the `network_status` registry entry beside the existing execution-safety kinds with deterministic weights `{ sourceReliability: 0.5, dataCompleteness: 0.3, derivationConfidence: 0.2, llmConfidence: 0 }`, standard thresholds, LLM redistribution enabled, and direct provenance restricted to `["solana-rpc"]`. Extend the literal arrays in `src/domain/taxonomy/validation.ts`.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 5: Commit**

  ```bash
  git add src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  git commit -m "feat: define deterministic Solana network status evidence"
  ```

## Task 2: Validate normalize identify and enrich Solana RPC batches

**Files:**

- Create: `src/domain/network-status/solana-rpc.ts`
- Create: `src/domain/network-status/identity.ts`
- Create: `src/domain/network-status/normalize.ts`
- Create: `src/domain/network-status/enrich.ts`
- Create: `src/domain/network-status/index.ts`
- Create: `tests/fixtures/solana-network-status.ts`
- Create: `tests/domain/network-status/solana-rpc.test.ts`
- Create: `tests/domain/network-status/identity.test.ts`
- Create: `tests/domain/network-status/normalize.test.ts`
- Create: `tests/domain/network-status/enrich.test.ts`

**Behavioral invariants to test first:**

- `accepts healthy getHealth and getSlot responses regardless of batch order`
- `accepts Solana node-behind error minus 32005 as degraded health evidence`
- `rejects duplicate missing unknown or mismatched JSON-RPC response ids`
- `normalizes a healthy batch without warnings`
- `normalizes node-behind and missing slot as explicit sorted warnings`
- `derives stable identity from network and collection instant only`
- `enriches network status with fresh deterministic direct provenance`

- [ ] **Step 1: Add fixtures and failing strict-validation tests**

  Fixtures must cover: ordered and reversed healthy batches; health `-32005` with `{ numSlotsBehind: 12 }`; slot error; duplicate id; missing id; unknown id; wrong `jsonrpc`; unsafe/negative slot; unsafe/negative slots-behind; and arbitrary provider fields. Define the accepted domain shape:

  ```ts
  export interface AcceptedSolanaNetworkStatus {
    readonly health: "ok" | "behind";
    readonly slot: number | null;
    readonly slotsBehind: number | null;
    readonly slotUnavailable: boolean;
  }

  export function acceptSolanaNetworkStatusBatch(input: unknown): AcceptedSolanaNetworkStatus;
  ```

  Run:

  ```bash
  pnpm test tests/domain/network-status/solana-rpc.test.ts
  ```

  Expected: FAIL because the network-status domain does not exist.

- [ ] **Step 2: Implement strict id-correlated validation**

  Require an array containing exactly one `"health"` and one `"slot"` JSON-RPC 2.0 response. Accept only `"ok"` or error code `-32005` for health. Require safe non-negative integers for slot and `numSlotsBehind`. A slot error is allowed and represented as `slot: null`; a health error other than `-32005`, mixed result/error members, duplicates, missing ids, or unknown ids throws `SolanaNetworkStatusValidationError`.

- [ ] **Step 3: Write failing identity and normalization tests**

  Define:

  ```ts
  export function deriveSolanaNetworkStatusObservationKey(input: {
    readonly network: "solana-mainnet-beta";
    readonly observedAtUnixMs: number;
  }): Promise<string>;

  export function normalizeSolanaNetworkStatus(input: {
    readonly accepted: AcceptedSolanaNetworkStatus;
    readonly observedAtUnixMs: number;
  }): NetworkStatusPayloadV1;
  ```

  Assert response ordering and provider-only extra fields do not affect identity. Assert warnings are sorted and deduplicated, healthy status has no warnings, `behind` always has `node_behind`, and a missing slot always has `slot_unavailable`.

  Run:

  ```bash
  pnpm test tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts
  ```

  Expected: FAIL because identity and normalization are not implemented.

- [ ] **Step 4: Implement identity normalization and deterministic enrichment**

  Hash `{ identityVersion: 1, network, observedAtUnixMs }` with `canonicalHash`. Normalize only accepted facts. Implement enrichment using `getObservationKindEntry("network_status")`, `computeFreshness`, `computeConfidence`, `validateProvenance`, and `canonicalizePayload`, following `src/domain/pool-statistics/enrich.ts`. Use direct raw provenance from `"solana-rpc"`, collector `"collect-solana-network-status"`, job name `"core-collection-job"`, source reliability `0.95`, completeness `1` with slot or `0.7` without it, derivation confidence `1`, and no LLM confidence.

  The enrichment test must assert `signalClass: "deterministic"`, `evidenceFamily: "execution_safety"`, one raw/source ref, the supplied run/code versions, and freshness based on the collection instant.

  Export the concrete enrichment result as `EnrichedNetworkStatusObservation` and keep the callable signature consistent across the domain barrel and collector:

  ```ts
  export function enrichNetworkStatus(input: {
    readonly rawObservationId: number;
    readonly sourceObservationKey: string;
    readonly rawPayloadHash: string;
    readonly observedAtUnixMs: number;
    readonly fetchedAtUnixMs: number;
    readonly receivedAtUnixMs: number;
    readonly payload: NetworkStatusPayloadV1;
    readonly nowMs: number;
    readonly codeVersion: string;
    readonly runId: string | null;
  }): Promise<EnrichedNetworkStatusObservation>;
  ```

- [ ] **Step 5: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
  pnpm exec eslint src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/network-status tests/fixtures/solana-network-status.ts tests/domain/network-status
  git commit -m "feat: normalize Solana RPC health observations"
  ```

## Task 3: Collect Solana status with raw-first persistence and bounded retries

**Files:**

- Create: `src/application/collect-solana-network-status.ts`
- Create: `tests/application/collect-solana-network-status.test.ts`

**Behavioral invariants to test first:**

- `persists a 2xx response before validating and normalizing it`
- `marks a persisted malformed RPC batch failed without normalized rows`
- `replays identical network status without duplicate raw or normalized rows`
- `rejects a same-identity different-payload replay as conflict`
- `retries timeout network 408 429 and 5xx at most twice with the identical batch`
- `does not retry permanent 4xx or malformed successful bodies`
- `returns degraded usable evidence for node-behind or slot-unavailable status`
- `never exposes RPC credentials or credential-bearing paths in metadata or diagnostics`

- [ ] **Step 1: Write failing collector lifecycle tests**

  Build dependencies from `FakeHttp`, `FakeRetry`, `FakeEnv`, `FakeObservationRepo`, `FakeNormalizedObservationRepo`, and `FakeJsonStore`. Record repository event order. Use this exported surface:

  ```ts
  export interface CollectSolanaNetworkStatusDeps {
    readonly http: HttpClient;
    readonly retryControl: RetryControl;
    readonly jsonStore: JsonStore;
    readonly env: EnvReader;
    readonly rawObservationRepo: RawObservationRepo;
    readonly normalizedObservationRepo: NormalizedObservationRepo;
  }

  export interface SolanaNetworkStatusSourceResult {
    readonly status:
      | "accepted"
      | "identical_replay"
      | "degraded"
      | "timeout"
      | "network"
      | "unavailable"
      | "malformed"
      | "conflict"
      | "failed";
    readonly hasUsableEvidence: boolean;
    readonly rawObservationId: number | null;
    readonly normalizedCount: number;
    readonly warnings: readonly NetworkStatusWarning[];
    readonly freshness: Freshness | null;
    readonly confidenceLevel: ConfidenceLevel | null;
    readonly diagnostic: string | null;
  }

  export function collectSolanaNetworkStatus(
    deps: CollectSolanaNetworkStatusDeps,
    context: CollectionRunContext
  ): Promise<SolanaNetworkStatusSourceResult>;
  ```

  Run:

  ```bash
  pnpm test tests/application/collect-solana-network-status.test.ts
  ```

  Expected: FAIL because the collector does not exist.

- [ ] **Step 2: Implement the stable request and bounded retry loop**

  Read required `SOLANA_RPC_URL`, optional `SOLANA_RPC_API_KEY`, and optional `INTELLIGENCE_CODE_VERSION`. Construct one immutable request value:

  ```ts
  const request = [
    { jsonrpc: "2.0", id: "health", method: "getHealth" },
    { jsonrpc: "2.0", id: "slot", method: "getSlot", params: [{ commitment: "confirmed" }] }
  ] as const;
  ```

  Call `postJsonRaw` with `timeoutMs: 5_000` and a bearer header only when configured. Perform at most two total attempts. Retry thrown `HttpRequestError` values only when `retryable`, and retry response statuses 408, 429, or 5xx. Sleep once between attempts with the established bounded delay `25 + jitterUnit() * 25`. Permanent 4xx returns `unavailable`; exhausted timeout/network retains its specific status. Do not retry a 2xx body even when its JSON-RPC shape is malformed.

- [ ] **Step 3: Implement raw-first ingestion and outcome mapping**

  For a 2xx response, canonicalize `response.body`, derive the identity from mainnet plus `context.startedAtUnixMs`, and call `ingestRawObservation` before `acceptSolanaNetworkStatusBatch`. Persist request metadata containing only method `"POST"`, a sanitized host label, network, RPC method names, code version, and run id—never headers, API key, full URL, query, or path.

  The ingestion callbacks must:
  1. validate stored canonical JSON;
  2. normalize exactly one `NetworkStatusPayloadV1`;
  3. enrich exactly one deterministic observation;
  4. insert it through `NormalizedObservationRepo.insertMany`;
  5. mark the raw row parsed only after normalized insertion.

  On parsed replay, recover the linked normalized row with `findByRawObservation(rawId, "network_status")`. Map `behind` or any warning to usable `degraded`; a clean replay to `identical_replay`; `RawObservationConflictError` to `conflict`; validation failure after insertion to `malformed` with the durable raw id; and unexpected persistence/enrichment failure to `failed`. Diagnostics must use stable redacted messages rather than echoing the configured URL or headers.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-solana-network-status.test.ts
  pnpm exec eslint src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts --max-warnings 0
  pnpm exec prettier --check src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 5: Commit**

  ```bash
  git add src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts
  git commit -m "feat: ingest Solana RPC status raw first"
  ```

## Task 4: Integrate Solana status into the five-source core run

**Files:**

- Modify: `src/contracts/collection-run.ts`
- Modify: `src/application/collect-core.ts`
- Modify: `src/application/source-outcome.ts`
- Modify: `src/domain/core-collection/reduce.ts`
- Modify: `src/jobs/core-collection-job.ts`
- Modify: `scripts/collectors/core-collection.ts`
- Modify: `tests/application/collect-core.test.ts`
- Modify: `tests/application/source-outcome.test.ts`
- Modify: `tests/domain/core-collection/reduce.test.ts`
- Modify: `tests/scripts/core-collection.test.ts`

**Atomic required-shape change:** `CoreSourceKey`, `CollectCoreDeps`, `CoreCollectionResult`, and `CoreCollectionJobDeps` gain required Solana members in this task. Every production constructor/caller and test implementation is updated in the same task so the automatic workspace typecheck remains green.

**Behavioral invariants to test first:**

- `starts all five leaves before awaiting and invokes each exactly once`
- `passes the same collection context object to all five leaves`
- `preserves four-source evidence when Solana RPC is unavailable`
- `returns COMPLETE only when all five sources contribute fresh usable evidence`
- `maps degraded Solana status to usable core evidence with explicit warnings`
- `maps unavailable Solana status to an explicit aggregate warning without fabricating evidence`
- `orders Solana warnings after the four existing source groups`
- `binds the Solana collector with the shared retry and persistence dependencies`
- `prints the Solana outcome and preserves existing exit semantics`

- [ ] **Step 1: Update failing coordinator and reducer tests**

  Change all `CollectCoreDeps` fixtures from four to five leaves, all “four” assertions to “five,” and all total-count expectations from 4 to 5. Add `"solana"` / `"solana-rpc"` outcomes. Assert:
  - all five promises start before the aggregate await;
  - a Solana timeout plus four accepted leaves is `PARTIAL`, `shouldFailCommand: false`, with counts `{ complete: 4, partial: 0, stale: 0, absentOrFailed: 1 }`;
  - all five accepted/replayed fresh leaves is `COMPLETE`;
  - a Solana conflict is `FAILED`;
  - warning order is CLMM, Pyth, Jupiter, Orca, Solana.

  Run:

  ```bash
  pnpm test tests/application/collect-core.test.ts tests/domain/core-collection/reduce.test.ts
  ```

  Expected: FAIL because the core contracts and coordinator still contain four sources.

- [ ] **Step 2: Expand the core contracts reducer and coordinator atomically**

  Make the required public shapes:

  ```ts
  export type CoreSourceKey = "clmm-v2" | "pyth" | "jupiter" | "orca" | "solana";

  export interface CollectCoreDeps {
    readonly clmmV2: CoreLeaf;
    readonly pyth: CoreLeaf;
    readonly jupiter: CoreLeaf;
    readonly orca: CoreLeaf;
    readonly solana: CoreLeaf;
  }
  ```

  Add `readonly solana: SourceCollectionOutcome` to `CoreCollectionResult`. Start and independently guard the fifth leaf before `Promise.all`, include it in the fixed outcome list, and add `solana: 4` to deterministic warning ordering. Do not change the reducer truth table: usable mixed runs remain `PARTIAL`, all absent/stale remain `UNAVAILABLE`, total malformed/unexpected failures remain `FAILED`, and any conflict remains `FAILED`.

- [ ] **Step 3: Add and test Solana source-outcome mapping**

  Add:

  ```ts
  export function mapSolanaNetworkStatusOutcome(
    result: SolanaNetworkStatusSourceResult
  ): SourceCollectionOutcome;
  ```

  It sets `sourceKey: "solana"`, `source: "solana-rpc"`, preserves status/usability/durable ids/freshness/confidence/diagnostic, and converts each payload warning to `{ source: "solana", code, message }`. Use stable messages: `"Solana RPC node is behind"` and `"Solana RPC slot is unavailable"`. For a non-usable status, also emit exactly one status warning—`solana_rpc_timeout`, `solana_rpc_network`, `solana_rpc_unavailable`, `solana_rpc_malformed`, `solana_rpc_conflict`, or `solana_rpc_failed`—so partial failure is visible in the aggregate warning list without inventing a normalized health value.

  Run:

  ```bash
  pnpm test tests/application/source-outcome.test.ts
  ```

  Expected: FAIL until the mapper is present, then PASS after implementation.

- [ ] **Step 4: Wire the job and CLI in the same required-shape change**

  Add `retryControl: RetryControl` to `CoreCollectionJobDeps`. Bind a `solana` leaf that calls `collectSolanaNetworkStatus(deps, context)` and maps it with `mapSolanaNetworkStatusOutcome`; guard unexpected rejection with `mapSourceError("solana", "solana-rpc", err)`. Pass `runtime.retryControl` from `scripts/collectors/core-collection.ts`.

  In `tests/scripts/core-collection.test.ts`, mock the new collector, add `retryControl` to runtime/dependency fixtures, assert the same context and dependencies reach the Solana leaf, include `solana` in printed COMPLETE/FAILED fixtures, and preserve connection-close plus exit-code assertions.

- [ ] **Step 5: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  pnpm exec eslint src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  pnpm exec depcruise --config .dependency-cruiser.cjs src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/collection-run.ts src/application/collect-core.ts src/application/source-outcome.ts src/domain/core-collection/reduce.ts src/jobs/core-collection-job.ts scripts/collectors/core-collection.ts tests/application/collect-core.test.ts tests/application/source-outcome.test.ts tests/domain/core-collection/reduce.test.ts tests/scripts/core-collection.test.ts
  git commit -m "feat: add Solana status to core collection"
  ```

## Task 5: Document configure and operate the five-source core

**Files:**

- Modify: `.env.example`
- Modify: `resources/sources.yaml`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Add operator-safe configuration**

  Add:

  ```dotenv
  SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
  SOLANA_RPC_API_KEY=
  ```

  Register `solana-rpc` in `resources/sources.yaml` as a high-priority deterministic RPC source for `network_status`, with 5-second timeout, two attempts, and limitations stating that it measures the configured endpoint rather than global consensus. Remove the old deterministic network-health deferment note while retaining the separate contextual protocol-incident source.

- [ ] **Step 2: Update architecture and runbook semantics**

  Change four-source diagrams/text to five sources and add Solana RPC alongside CLMM, Pyth, Jupiter, and Orca. Document:
  - `getHealth` and `getSlot` batch collection;
  - raw-first persistence for 2xx bodies;
  - `node_behind` and `slot_unavailable`;
  - two-attempt leaf-local retry behavior;
  - `COMPLETE` requiring five fresh usable outcomes;
  - a Solana-only outage producing `PARTIAL` when the other four are usable;
  - credential redaction and the configured-endpoint limitation;
  - troubleshooting for timeout, 408, 429, 5xx, malformed JSON-RPC, and `-32005`.

  Keep `solana-status-api` protocol incidents documented as contextual evidence so operators do not confuse it with live RPC health.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  git diff --check -- .env.example resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  pnpm exec prettier --check resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  sed -n '30,48p' .env.example
  sed -n '55,92p' resources/sources.yaml
  sed -n '258,310p' README.md
  sed -n '100,150p' docs/architecture.md
  sed -n '48,92p' docs/operator-runbook.md
  ```

  Expected: diff/prettier checks pass; the scoped excerpts show the two environment variables, five-source flow, status semantics, and no deferment claim or credential value.

- [ ] **Step 4: Commit**

  ```bash
  git add .env.example resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  git commit -m "docs: operate five-source deterministic collection"
  ```

## Tests to add or update

- Add strict JSON-RPC batch validation tests in `tests/domain/network-status/solana-rpc.test.ts`.
- Add stable source identity tests in `tests/domain/network-status/identity.test.ts`.
- Add health/warning normalization tests in `tests/domain/network-status/normalize.test.ts`.
- Add freshness, confidence, and provenance tests in `tests/domain/network-status/enrich.test.ts`.
- Add raw-first, replay, conflict, retry, failure-classification, and credential-redaction tests in `tests/application/collect-solana-network-status.test.ts`.
- Update taxonomy registry/runtime parity tests for `network_status` and `solana-rpc`.
- Update core coordinator/reducer tests from four to five required leaves and add Solana partial-failure/conflict/warning-order cases.
- Update source-outcome tests for payload-warning mapping.
- Update core job/CLI tests for dependency binding, printed outcome, cleanup, and exit behavior.
- Existing CLMM, Pyth, Jupiter, Orca, shared ingestion, HTTP, and repository tests remain regression coverage and are not rewritten.

## Validation commands

The implement loop runs `pnpm -r typecheck` after every task. Task-specific commands are listed inside each task and operate only on files explicitly in that task. After all implementation tasks, the dedicated validation phase may run the repository’s standard aggregate checks:

```bash
pnpm verify
```

Expected: typecheck, lint, formatting, all Vitest suites, and dependency boundaries pass. This is not a standalone implementation task.

## Risk areas

- **Endpoint versus network truth:** one RPC node can be degraded while Solana remains healthy, or vice versa. Payload naming and docs must say “configured endpoint” and must not overclaim global consensus.
- **Raw-first malformed data:** a 2xx malformed batch must leave a failed raw row, while transport/non-2xx failures have no accepted body to normalize. Tests must distinguish these cases.
- **JSON-RPC correlation:** batch order is not stable. Correlating by array position can swap health and slot facts.
- **Retry multiplication:** only the Solana leaf retries, at most twice. Do not add coordinator retries or pass hidden retry counts into `postJsonRaw`.
- **Idempotency identity:** using response order, slot, payload hash, request id generation, or endpoint URL in `sourceObservationKey` would destabilize replay semantics.
- **Required-shape blast radius:** expanding `CoreSourceKey`, `CollectCoreDeps`, `CoreCollectionResult`, and `CoreCollectionJobDeps` must update every caller in Task 4.
- **Secret leakage:** hosted RPC URLs often contain credentials in paths or query strings. Metadata and diagnostics must never retain the full configured URL.
- **Taxonomy collision:** deterministic `network_status` must remain distinct from contextual `protocol_incident`.
- **Test-file size:** `tests/domain/taxonomy/registry.test.ts` exceeds 500 lines, but Task 1 is a contract/taxonomy implementation task, not a primary test-update task; modifications are explicitly restricted to parity data and one new describe block.

## Stop conditions

Abort implementation and report the blocker instead of continuing if any of these conditions is discovered:

- `SOLANA_RPC_URL` is intended to represent a quorum/fan-out provider contract rather than standard Solana JSON-RPC 2.0; that changes identity, payload, and health semantics.
- The target RPC does not support batched `getHealth` and `getSlot`, and choosing separate-request persistence semantics would require a product decision.
- The existing database schema or repository rejects the new taxonomy literals or JSON payload without a migration; schema work is outside this plan and must be replanned explicitly.
- A new port/interface method becomes necessary. Stop and revise the relevant task so the port change and every adapter/fake implementation remain atomic.
- The operator requires retention of literal HTTP wire bytes rather than the repository’s established canonical-JSON raw representation.
- Tests reveal that adding a fifth required core leaf would break a documented external consumer that cannot accept the additive `solana` result member.
- Safe diagnostics cannot be produced without exposing credential-bearing endpoint material.
- Implementing the source would require transaction submission, signing, wallet access, or any authority prohibited by `AGENTS.md`.
