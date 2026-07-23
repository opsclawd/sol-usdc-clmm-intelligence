<!-- plan-review-required -->

# SOL/USDC Support/Resistance Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect provider-neutral SOL/USDC support/resistance point and zone assertions, retain a bounded auditable source snapshot, normalize them into contextual evidence with freshness/confidence/provenance, and persist exact replays idempotently without merging distinct sources or disagreements.

**Architecture:** Add one contextual observation kind and a strict v1 payload contract, then keep provider response shaping, pure validation/normalization/enrichment, and raw-first persistence in separate layers. A source port and its Node HTTP adapter return a licensing-safe bounded snapshot; the application use case feeds that snapshot through the existing `ingestRawObservation` state machine and existing JSONB repositories. A thin job and CLI expose the collector without publishing policy or changing Regime Engine contracts.

**Tech Stack:** TypeScript 5.7, Vitest 2, existing `HttpClient`/environment/clock ports, Drizzle-backed raw and normalized observation repositories, Node/tsx CLI, ESLint, Prettier.

---

### Goal

Deliver the first PR-sized contextual-evidence slice from issue #27: one configurable technical-analysis source, strict point/zone normalization, bounded raw retention, deterministic within-run equivalence grouping, exact replay handling, explicit stale/degraded outcomes, and an operator-facing command.

### Non-goals

- Do not publish an evidence bundle to Regime Engine or change the canonical `PolicyInsight` contract.
- Do not alter clmm-v2 guards, execution rules, rebalance logic, transaction code, or user-facing UI.
- Do not create macro, incident, news, regulatory, on-chain-flow, perp, liquidation, or LLM-brief collectors.
- Do not infer numeric levels from prose, convert points into zones, combine distinct providers into consensus, or overwrite historical normalized evidence.
- Do not add a database migration: the existing raw and normalized JSONB payload columns and uniqueness constraints are sufficient.
- Do not add retries beyond the existing `HttpClient` request options; unavailable sources produce an explicit non-persisting outcome.

### Affected files

- `src/contracts/taxonomy.ts`
- `src/contracts/support-resistance.ts` (new)
- `src/contracts/index.ts`
- `src/domain/taxonomy/registry.ts`
- `tests/contracts/support-resistance.test.ts` (new)
- `tests/domain/taxonomy/registry.test.ts`
- `tests/domain/taxonomy/confidence.test.ts`
- `src/domain/support-resistance/validate.ts` (new)
- `src/domain/support-resistance/normalize.ts` (new)
- `src/domain/support-resistance/identity.ts` (new)
- `src/domain/support-resistance/enrich.ts` (new)
- `src/domain/support-resistance/index.ts` (new)
- `tests/fixtures/support-resistance.ts` (new)
- `tests/domain/support-resistance/validate.test.ts` (new)
- `tests/domain/support-resistance/normalize.test.ts` (new)
- `tests/domain/support-resistance/identity.test.ts` (new)
- `tests/domain/support-resistance/enrich.test.ts` (new)
- `src/ports/support-resistance-source.ts` (new)
- `src/ports/index.ts`
- `src/adapters/node/http-support-resistance-source.ts` (new)
- `tests/fakes/fake-support-resistance-source.ts` (new)
- `tests/fakes/index.ts`
- `tests/adapters/node/http-support-resistance-source.test.ts` (new)
- `src/application/collect-support-resistance.ts` (new)
- `tests/application/collect-support-resistance.test.ts` (new)
- `tests/adapters/node/drizzle-support-resistance.integration.test.ts` (new)
- `src/jobs/support-resistance-job.ts` (new)
- `src/jobs/index.ts`
- `scripts/collectors/support-resistance.ts` (new)
- `tests/jobs/support-resistance-job.test.ts` (new)
- `tests/scripts/support-resistance.test.ts` (new)
- `package.json`
- `.env.example`
- `README.md`
- `docs/architecture.md`
- `docs/operator-runbook.md`

### Behavioral model and invariants

The collection flow reuses `ingestRawObservation` and must preserve these transitions:

| Input / current state                                                 | Required transition and observable result                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source timeout/network/unavailable                                    | Return an unavailable outcome; create no raw or normalized row.                                                                                                       |
| Adapter payload cannot be bounded/validated                           | Return malformed; create no raw or normalized row.                                                                                                                    |
| New source-run identity + valid retained snapshot                     | Insert raw as `pending`, normalize accepted claims, then set raw to `parsed`.                                                                                         |
| New raw row + no claim with an explicit point or complete zone        | Retain raw material, insert no normalized claim for the missing level, set raw to `parsed`, and return degraded with `missing_level`.                                 |
| Normalization/persistence throws after raw insert                     | Best-effort transition raw from `pending` to `failed`; preserve the original error as the diagnostic.                                                                 |
| Existing `parsed` identity + identical raw hash                       | Return `identical_replay`, reuse the raw row, and insert no additional normalized rows.                                                                               |
| Existing `pending` or `failed` identity + identical raw hash          | Revalidate stored canonical content, insert missing normalized rows idempotently, and transition to `parsed`.                                                         |
| Existing identity + different raw hash                                | Return conflict; do not overwrite raw or normalized history.                                                                                                          |
| Same provider/run contains deterministically equivalent claims        | Retain both claims in raw material but emit one normalized claim with a `duplicate_equivalent_claim` warning.                                                         |
| Same level comes from different providers or different run identities | Persist independently; never merge into consensus.                                                                                                                    |
| Claim is expired/stale at collection time                             | Persist as contextual evidence with `isStale=true`, `allow_context_only`, a stale warning, and freshness-degraded confidence; never expose it as execution authority. |

The exact invariant names and test case names are repeated in `task-manifest.json`; implementers write those tests before implementation.

## Task 1: Define the support/resistance contract and taxonomy policy

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/support-resistance.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Create: `tests/contracts/support-resistance.test.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` only in the `observationKindRegistry` kind list and a new dedicated `support_resistance_level` describe block
- Modify: `tests/domain/taxonomy/confidence.test.ts` only to account for the extended `ConfidenceReason` union in type-checking contexts

**Exported API changes:** extend `ObservationKind` with `"support_resistance_level"`, extend `Source` with `"technical-analysis-api"`, and export the new raw snapshot, claim, normalized payload, warning, and collection-result types from `src/contracts/support-resistance.ts` through `src/contracts/index.ts`. No existing repository-port method changes in this task.

- [ ] **Step 1: Write the contract and registry tests first.**

  Add exact test cases named `represents point and zone levels without silent conversion` and `registers support resistance as contextual support_resistance evidence`. The contract test should compile representative payloads with the following discriminated shape and assert that point-only fields do not appear on a zone and zone bounds do not appear on a point:

  ```ts
  export type SupportResistanceLevel =
    | {
        readonly levelType: "point";
        readonly levelUsdcPerSol: number;
      }
    | {
        readonly levelType: "zone";
        readonly zoneLowerUsdcPerSol: number;
        readonly zoneUpperUsdcPerSol: number;
      };

  export type SupportResistancePayloadV1 = SupportResistanceLevel & {
    readonly kind: "support_resistance_level";
    readonly schemaVersion: 1;
    readonly pair: "SOL/USDC";
    readonly unit: "USDC_PER_SOL";
    readonly evidenceSide: "SUPPORT" | "RESISTANCE";
    readonly timeframe: string;
    readonly thesisCodes: readonly string[];
    readonly asOfUnixMs: number;
    readonly expiresAtUnixMs: number;
    readonly invalidationConditions: readonly string[];
    readonly warnings: readonly SupportResistanceWarning[];
    readonly sourceReferences: readonly string[];
    readonly sourceQuality: {
      readonly providerId: string;
      readonly reliability: number;
      readonly completeness: "complete" | "partial";
    };
  };
  ```

  The registry test must assert evidence family `support_resistance`, signal class `contextual`, stale behavior `allow_context_only`, schema version `1`, and only `technical-analysis-api` in allowed direct source refs.

- [ ] **Step 2: Run the focused tests and confirm the expected red state.**

  Run: `pnpm exec vitest run tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: FAIL because the new contract exports and registry entry do not exist.

- [ ] **Step 3: Add the minimal contracts and policy.**

  Define a provider-neutral retained snapshot with `providerId`, `providerRunId`, `pair`, `asOfUnixMs`, `sourceReferences`, and `claims`. Each raw claim permits optional point/zone fields so missing-level source material can be retained, and includes bounded `sourceExtract?: string`; the strict normalized union above must not permit an absent or mixed level. Add warning codes:

  ```ts
  export type SupportResistanceWarning =
    | "ambiguous_source_claim"
    | "conflicting_source_claim"
    | "duplicate_equivalent_claim"
    | "missing_invalidation_conditions"
    | "missing_level"
    | "missing_source_reference"
    | "stale_observation";
  ```

  Add `SupportResistanceCollectionResult` with statuses `accepted | degraded | stale | identical_replay | conflict | malformed | timeout | network | unavailable | failed`, `hasUsableEvidence`, raw ID/count, warnings, freshness, confidence level, and diagnostic. Extend `ConfidenceReason` with `contextual_source_quality_cap_applied` so a contextual cap is auditable. Register a 24-hour maximum observed age, source-expiry-aware freshness, `allow_context_only`, and confidence weights of source reliability `0.45`, completeness `0.35`, derivation confidence `0.20`, and LLM confidence `0`.

- [ ] **Step 4: Run focused verification.**

  Run: `pnpm exec vitest run tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: PASS, including the two named cases.

  Run: `pnpm exec eslint src/contracts/taxonomy.ts src/contracts/support-resistance.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/support-resistance.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 5: Commit the contract slice.**

  ```bash
  git add src/contracts/taxonomy.ts src/contracts/support-resistance.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts
  git commit -m "feat: define support resistance evidence contract"
  ```

## Task 2: Implement pure validation, normalization, equivalence, and enrichment

**Files:**

- Create: `src/domain/support-resistance/validate.ts`
- Create: `src/domain/support-resistance/normalize.ts`
- Create: `src/domain/support-resistance/identity.ts`
- Create: `src/domain/support-resistance/enrich.ts`
- Create: `src/domain/support-resistance/index.ts`
- Create: `tests/fixtures/support-resistance.ts`
- Create: `tests/domain/support-resistance/validate.test.ts`
- Create: `tests/domain/support-resistance/normalize.test.ts`
- Create: `tests/domain/support-resistance/identity.test.ts`
- Create: `tests/domain/support-resistance/enrich.test.ts`

**Exported API changes:** add pure exported functions `acceptSupportResistanceSnapshot`, `normalizeSupportResistanceClaims`, `deriveSupportResistanceSourceObservationKey`, `deriveSupportResistanceEquivalenceKey`, and `enrichSupportResistanceClaim`, plus their input/output/error types. Existing signatures remain unchanged.

- [ ] **Step 1: Add fixtures and failing validation/normalization tests.**

  Build one reusable snapshot fixture containing a support point and resistance zone. Write these exact cases first:
  - `accepts a bounded SOL/USDC snapshot and trims retained extracts to 500 characters`
  - `rejects the wrong pair invalid timestamps and out-of-range source reliability`
  - `normalizes an explicit point without zone fields`
  - `normalizes ordered zone bounds without a point field`
  - `does not fabricate a normalized claim when a source claim has no numeric level`
  - `rejects mixed point and zone fields and inverted or non-positive bounds`
  - `adds explicit warnings for missing references invalidation rules and ambiguity`

  Validation must clone only the allowlisted fields from the unknown response. It must never retain arbitrary provider keys or a full article body. Normalize strings by trimming, deduplicate/sort thesis codes, invalidation conditions, warnings, and references, while preserving explicit point-versus-zone semantics.

- [ ] **Step 2: Run validation/normalization tests and confirm they fail.**

  Run: `pnpm exec vitest run tests/domain/support-resistance/validate.test.ts tests/domain/support-resistance/normalize.test.ts`

  Expected: FAIL because the pure domain modules do not exist.

- [ ] **Step 3: Implement strict acceptance and normalization.**

  `acceptSupportResistanceSnapshot(input: unknown)` must require a non-empty provider/run identity, `SOL/USDC`, finite integer timestamps, an array of claims, arrays for source references whose present entries are non-empty strings, and reliability in `[0, 1]`; return a newly built bounded snapshot rather than the original object. Empty reference arrays remain representable and produce `missing_source_reference` during normalization. `normalizeSupportResistanceClaims(snapshot)` must return both accepted payloads and rejected claim diagnostics so a missing level becomes unavailable/degraded rather than fabricated.

  Use the following deterministic level validation:

  ```ts
  if (claim.levelType === "point") {
    accept only Number.isFinite(levelUsdcPerSol) && levelUsdcPerSol > 0;
    reject any supplied zone bound;
  }
  if (claim.levelType === "zone") {
    accept only finite positive lower/upper bounds with lower < upper;
    reject any supplied point value;
  }
  otherwise reject with "missing_level";
  ```

  Preserve a source-supplied expiry even when already expired; do not rewrite it to a future time.

- [ ] **Step 4: Add failing identity/equivalence tests.**

  Write exact cases:
  - `derives a source observation key from provider and provider run identity`
  - `groups only materially equivalent claims from the same provider run`
  - `keeps point and zone assertions distinct`
  - `keeps different sides timeframes theses providers and runs distinct`

  The equivalence key must canonicalize exactly: provider ID, provider run ID, pair, side, level type, point or both zone bounds, timeframe, and sorted thesis codes. Do not include warnings, prose extract, source URL order, or invalidation prose, because those do not change the asserted technical level; do include provider/run so cross-source claims remain independent.

- [ ] **Step 5: Implement deterministic identity and within-run grouping.**

  Hash canonical identity objects with the existing `canonicalizePayload`; group duplicates in original claim order, retain one normalized payload, and append `duplicate_equivalent_claim`. The source observation key must be a stable hash-derived `providerId:providerRunId` identity and must not include fetched time, so exact source-run replays hit the existing raw uniqueness boundary.

- [ ] **Step 6: Add failing enrichment tests.**

  Write exact cases:
  - `enriches a fresh claim with contextual taxonomy confidence and direct raw provenance`
  - `caps confidence at source quality and completeness`
  - `marks an expired claim stale and degrades confidence for context-only use`

  Assert `sourceValidUntilUnixMs` is passed to `computeFreshness`, provenance contains the raw observation ref and process metadata, stale payloads gain `stale_observation`, and normalized payload hashes are computed after warnings are finalized.

- [ ] **Step 7: Implement enrichment with existing taxonomy primitives.**

  Build direct provenance from the raw row using source `technical-analysis-api`, collector `http-support-resistance-source`, job `support-resistance-enrichment`, code version, and pipeline run ID. Compute completeness from presence of references and invalidation conditions; use the source reliability directly, derivation confidence `1`, and no LLM confidence. After `computeConfidence`, cap the composite at `Math.min(sourceReliability, dataCompleteness)`, rederive the level with the registry thresholds, and add `contextual_source_quality_cap_applied` when the cap changes the score. Apply the stale factor before that cap so expiry can only reduce confidence. Pass `{ factor: 0.5 }` for stale claims and validate provenance against the new taxonomy entry.

- [ ] **Step 8: Run focused verification.**

  Run: `pnpm exec vitest run tests/domain/support-resistance/validate.test.ts tests/domain/support-resistance/normalize.test.ts tests/domain/support-resistance/identity.test.ts tests/domain/support-resistance/enrich.test.ts`

  Expected: PASS for all named point, zone, missing, equivalence, freshness, confidence, and provenance cases.

  Run: `pnpm exec eslint src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts`

  Expected: all listed paths use Prettier formatting.

- [ ] **Step 9: Commit the pure domain slice.**

  ```bash
  git add src/domain/support-resistance tests/domain/support-resistance tests/fixtures/support-resistance.ts
  git commit -m "feat: normalize support resistance claims"
  ```

## Task 3: Add the source port and Node HTTP adapter together

**Files:**

- Create: `src/ports/support-resistance-source.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/http-support-resistance-source.ts`
- Create: `tests/fakes/fake-support-resistance-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-support-resistance-source.test.ts`

**Port/interface atomicity:** this task adds `SupportResistanceSourcePort.collect` and includes both concrete implementations in the same task: `HttpSupportResistanceSource` for Node and `FakeSupportResistanceSource` for tests. Do not commit the port without both implementations; the automatic workspace `pnpm -r typecheck` gate must pass after this task.

**Exported API changes:** export `SupportResistanceSourcePort`, `SupportResistanceSourceRequest`, `SupportResistanceSourceError`, and `HttpSupportResistanceSource`. The required method shape is `collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot>`.

- [ ] **Step 1: Write adapter contract tests first.**

  Add exact cases:
  - `fetches SOL/USDC claims with bounded request options and an optional bearer credential`
  - `returns only the validated bounded snapshot and never retains unknown provider fields`
  - `classifies timeout network http status and malformed payload failures without leaking credentials`

  Configure the adapter through a constructor object containing `http`, `url`, optional `apiKey`, `timeoutMs: 5000`, and `maxAttempts: 2`. Assert the credential is sent only in the request header and no thrown diagnostic contains it.

- [ ] **Step 2: Run the adapter test and confirm it fails.**

  Run: `pnpm exec vitest run tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: FAIL because the port, fake, and adapter do not exist.

- [ ] **Step 3: Define the port and both implementations in one change.**

  Use a narrow request:

  ```ts
  export interface SupportResistanceSourceRequest {
    readonly pair: "SOL/USDC";
  }

  export interface SupportResistanceSourcePort {
    collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot>;
  }
  ```

  The HTTP adapter calls `getJson<unknown>`, passes the unknown response through `acceptSupportResistanceSnapshot`, and maps `HttpRequestError` to `SupportResistanceSourceError` kinds `timeout | network | unavailable | malformed`. Treat HTTP 404, 429, and 5xx as unavailable; invalid JSON or domain-validation failure as malformed; other transport failures as network. Store only configured fake responses in the test fake and record requests for assertions.

- [ ] **Step 4: Run focused verification.**

  Run: `pnpm exec vitest run tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: PASS for request shaping, bounded response projection, failure classification, and secret redaction.

  Run: `pnpm exec eslint src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 5: Commit the complete port/adapter slice.**

  ```bash
  git add src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts
  git commit -m "feat: add support resistance source adapter"
  ```

## Task 4: Orchestrate raw-first collection and durable idempotency

**Files:**

- Create: `src/application/collect-support-resistance.ts`
- Create: `tests/application/collect-support-resistance.test.ts`
- Create: `tests/adapters/node/drizzle-support-resistance.integration.test.ts`

**Exported API changes:** add `CollectSupportResistanceDeps` and `collectSupportResistance(deps, context): Promise<SupportResistanceCollectionResult>`. Existing raw and normalized repository ports and adapters are deliberately unchanged.

- [ ] **Step 1: Write collection state-transition tests first.**

  Add these exact test cases before the use case:
  - `persists bounded raw material before normalized claims and marks the raw row parsed`
  - `returns unavailable without persistence when the source cannot be collected`
  - `returns malformed without persistence when the bounded source payload is invalid`
  - `retains a missing-level claim as raw degraded evidence without fabricating a normalized level`
  - `marks the raw row failed when normalization persistence fails`
  - `collapses an identical parsed replay without duplicate normalized rows`
  - `recovers an identical pending or failed replay and transitions it to parsed`
  - `rejects a conflicting replay without overwriting history`
  - `groups equivalent same-provider-run claims and records a duplicate warning`
  - `preserves different providers runs sides timeframes and theses independently`
  - `persists expired evidence as stale context-only evidence with degraded confidence`

  Use `FakeSupportResistanceSource`, `FakeObservationRepo`, `FakeNormalizedObservationRepo`, and a fixed `CollectionRunContext`. Assert raw canonical JSON contains only the accepted bounded snapshot and request metadata contains provider ID, provider run ID, pair, code version, and pipeline run ID but never an API key, bearer header, or arbitrary provider response field.

- [ ] **Step 2: Run the application test and confirm it fails.**

  Run: `pnpm exec vitest run tests/application/collect-support-resistance.test.ts`

  Expected: FAIL because `collectSupportResistance` does not exist.

- [ ] **Step 3: Implement collection by composing existing ingestion behavior.**

  Dependencies are the source port, clock/env metadata, raw repository, and normalized repository. The use case must:
  1. call the source port for `SOL/USDC` and map `SupportResistanceSourceError` without persistence;
  2. canonicalize the already-bounded snapshot and derive the provider/run source identity;
  3. call `ingestRawObservation` with source `technical-analysis-api` and parse status `pending`;
  4. revalidate stored canonical content for pending/failed replay recovery;
  5. normalize, group equivalent claims, enrich each accepted claim, and call `insertMany` once;
  6. rely on `ingestRawObservation` to classify identical/conflicting raw identities and finalize `parsed`/`failed` status;
  7. derive result status as stale when every usable row is stale, degraded when any claim was rejected or warned, identical replay only after recovering existing normalized rows, and accepted otherwise.

  When an already parsed replay returns `normalizedCount: 0`, call existing `findBySource(SOURCE, "support_resistance_level", rawRow.receivedAtUnixMs)` and filter the returned rows by `rawObservationId` for the result summary; `findByRawObservation` returns only one row and is insufficient for a multi-claim snapshot. Do not interpret zero new rows as zero usable evidence. The use case writes no compatibility JSON file.

- [ ] **Step 4: Add database-backed tests for the unchanged persistence boundary.**

  In the new integration file, follow the existing `DATABASE_URL` skip/cleanup pattern from `tests/adapters/node/drizzle-observation-repos.integration.test.ts`. Add exact cases:
  - `persists support resistance JSONB confidence freshness and provenance without a schema migration`
  - `returns the existing normalized row for an identical payload hash and keeps distinct payloads independent`

  Exercise only `DrizzleObservationRepo` and `DrizzleNormalizedObservationRepo`. Verify point and zone payloads round-trip, `validUntilUnixMs`, `isStale`, `allow_context_only`, confidence, and raw provenance survive mapping. Use unique provider/run keys so the test remains isolated.

- [ ] **Step 5: Run focused verification.**

  Run: `pnpm exec vitest run tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts`

  Expected: PASS; when `DATABASE_URL` is absent, only the integration cases are explicitly skipped by their existing test-environment guard.

  Run: `pnpm exec eslint src/application/collect-support-resistance.ts tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/application/collect-support-resistance.ts tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 6: Commit the durable collection slice.**

  ```bash
  git add src/application/collect-support-resistance.ts tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts
  git commit -m "feat: collect durable support resistance evidence"
  ```

## Task 5: Expose the collector through a job, CLI, configuration, and documentation

**Files:**

- Create: `src/jobs/support-resistance-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/support-resistance.ts`
- Create: `tests/jobs/support-resistance-job.test.ts`
- Create: `tests/scripts/support-resistance.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md` only in scripts/configuration/contextual-collector sections
- Modify: `docs/architecture.md` only in pipeline/component-flow sections
- Modify: `docs/operator-runbook.md` only in collector commands and degraded-outcome guidance

**Exported API changes:** add `SupportResistanceJobDeps`, `supportResistanceJob`, and `runSupportResistanceJob` exports. The Node runtime interface remains unchanged; the CLI constructs `HttpSupportResistanceSource` from `runtime.http` and non-secret environment configuration, then supplies existing persistence/runtime dependencies to the job.

- [ ] **Step 1: Write job and CLI tests first.**

  Add exact cases:
  - `creates one collection run context and delegates to the support resistance use case`
  - `prints a structured accepted result and exits zero when usable contextual evidence exists`
  - `prints a structured degraded result and exits zero when raw evidence is retained but no level is usable`
  - `exits nonzero for conflict malformed timeout network unavailable and failed outcomes without printing secrets`

  Mock the job in the script test and mock `createNodeRuntime` with HTTP, env, clock, run-ID factory, and persistence. Assert the adapter reads `SUPPORT_RESISTANCE_API_URL` and optional `SUPPORT_RESISTANCE_API_KEY`, but structured output redacts secret-looking keys and values using the established collector redaction pattern.

- [ ] **Step 2: Run job/CLI tests and confirm they fail.**

  Run: `pnpm exec vitest run tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts`

  Expected: FAIL because the job and script do not exist.

- [ ] **Step 3: Implement the job and thin script.**

  `runSupportResistanceJob` creates one context with `createCollectionRunContext` and delegates. Add package script `collect:support-resistance` with command `tsx scripts/collectors/support-resistance.ts`. The CLI prints the result as formatted JSON, sets exit code `0` for accepted, identical replay, stale, or degraded outcomes, and `1` for conflict, malformed, timeout, network, unavailable, or failed outcomes. It must not publish, retry in a loop, or write local snapshots.

- [ ] **Step 4: Document configuration, operation, and authority boundary.**

  Add these environment entries with blank safe defaults:

  ```dotenv
  SUPPORT_RESISTANCE_API_URL=
  SUPPORT_RESISTANCE_API_KEY=
  ```

  Update the scoped README sections with the raw-to-normalized flow, point/zone distinction, bounded extracts, exact replay behavior, `allow_context_only` semantics, and `pnpm collect:support-resistance`. Update architecture documentation to place the source port/adapter and new application use case in their proper layers. Update the operator runbook with accepted/degraded/stale/failure exit behavior and the instruction that missing or expired levels never become execution authority.

- [ ] **Step 5: Run focused verification.**

  Run: `pnpm exec vitest run tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts`

  Expected: PASS for context creation, dependency wiring, exit status, structured output, and secret redaction.

  Run: `pnpm exec eslint src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts package.json .env.example README.md docs/architecture.md docs/operator-runbook.md`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 6: Commit the runnable/documented slice.**

  ```bash
  git add src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts package.json .env.example README.md docs/architecture.md docs/operator-runbook.md
  git commit -m "feat: expose support resistance collector"
  ```

### Tests to add or update

- Contract/type tests for strict point/zone discrimination and explicit `USDC_PER_SOL` units.
- Taxonomy registry tests for contextual classification, freshness, confidence, and allowed source provenance.
- Pure domain tests for bounded retention, validation, normalization, missing/malformed levels, deterministic equivalence, stale behavior, confidence, and provenance.
- Adapter tests for request shaping, optional credentials, bounded projection, error classification, and secret-safe diagnostics.
- Application state-transition tests covering accepted, degraded, stale, replay recovery, conflict, unavailable, failed normalization, same-run equivalence, and cross-provider independence.
- Drizzle integration tests demonstrating that existing JSONB tables round-trip the new payload and keep idempotent versus distinct rows correctly.
- Job and CLI tests for run-context wiring, structured output, exit behavior, and redaction.

### Validation commands after all implementation tasks

The orchestrator automatically runs workspace-wide `pnpm -r typecheck` after each task. After all five implementation tasks, the dedicated validate phase should run the repository-standard commands; these are not a standalone implementation task:

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm boundaries
```

Expected: all commands exit 0. The database integration file may report its cases skipped when `DATABASE_URL` is not configured; with a test database configured, those cases must pass.

### Risk areas

- **Licensing/retention:** retaining arbitrary response objects could copy prohibited source content. The adapter/domain boundary must rebuild an allowlisted snapshot and hard-cap each extract at 500 characters before canonical persistence.
- **False consensus:** omitting provider/run, side, timeframe, type, or thesis from equivalence identity could merge distinct assertions. Identity tests lock each dimension.
- **Numeric ambiguity:** coercing prose or malformed strings into numbers could fabricate levels. Only finite positive explicit numeric fields are accepted; mixed point/zone and inverted zone shapes are rejected.
- **Replay semantics:** a parsed replay reports zero newly inserted rows, so the result must recover its linked normalized evidence rather than report no usable data.
- **State recovery:** raw rows can remain pending/failed after downstream persistence errors. Replay must validate stored bounded canonical content and rely on normalized uniqueness for safe recovery.
- **Freshness/confidence:** source expiry must participate in `computeFreshness`, and stale confidence must degrade while remaining contextual-only.
- **Credential leakage:** API credentials may appear only in outbound headers and must be absent from canonical payloads, request metadata, diagnostics, and CLI output.
- **Provider specificity:** the first adapter assumes a provider-neutral response contract. Provider-specific field mapping beyond that contract is a later adapter, not permissive parsing in this slice.

### Stop conditions

Abort implementation and report the blocker instead of broadening scope if any of these occur:

- The target provider cannot legally supply/store the proposed bounded fields or references under its license.
- The real provider response cannot supply explicit numeric point/zone values, timeframe, provider/run identity, source references, as-of time, and expiry without inference.
- Regime Engine requires a different canonical evidence/publish contract in this PR; that is cross-repo scope and needs a separate design decision.
- Existing database constraints cannot persist multiple normalized claims from one raw observation without migration. Do not silently change identity semantics or add a migration without revisiting the design.
- Implementing the port reveals another production adapter or fake required by the compiler beyond the two listed in Task 3. Keep the interface and every implementation in one atomic task before continuing.
- A planned task would require storing credentials, full copyrighted articles, or unbounded provider payloads.
- The automatic workspace typecheck fails because of an unrelated pre-existing worktree change; preserve user changes and report the exact failure rather than modifying unrelated files.

### Assumptions

- `issue-comments.md` is intentionally empty and adds no requirements.
- One configurable provider-neutral `technical-analysis-api` adapter is the first PR-sized source implementation; additional concrete providers can implement the same port later.
- The existing `raw_observations` and `normalized_observations` JSONB columns and normalized uniqueness key are authoritative and need no migration.
- Source reliability is provider-supplied configuration/data constrained to `[0, 1]`; it is metadata, not a deterministic fact, and confidence cannot exceed it.
- Distinct provider runs are historical observations that expire naturally; this slice does not add a supersession column.
- Missing-level claims are retained in bounded raw evidence and surfaced as degraded warnings, but never become normalized numeric evidence.
