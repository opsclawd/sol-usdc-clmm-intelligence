# Task Context: Task 4

Title: Orchestrate raw-first collection and durable idempotency

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-27
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-27
Start Commit: 8d258115c27c92c40909384db9d08dca77ae3750

## Task Requirements

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

## Repository Targets

### Expected Files

- src/application/collect-support-resistance.ts
- tests/application/collect-support-resistance.test.ts
- tests/adapters/node/drizzle-support-resistance.integration.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts
pnpm exec eslint src/application/collect-support-resistance.ts tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts --max-warnings 0
pnpm exec prettier --check src/application/collect-support-resistance.ts tests/application/collect-support-resistance.test.ts tests/adapters/node/drizzle-support-resistance.integration.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **raw-before-normalized**: A new valid snapshot is inserted pending, normalized, then transitioned to parsed with bounded request metadata. (Test: `persists bounded raw material before normalized claims and marks the raw row parsed`)
- **unavailable-no-persistence**: Source unavailability returns an explicit outcome without any raw or normalized insert. (Test: `returns unavailable without persistence when the source cannot be collected`)
- **malformed-no-persistence**: A malformed source snapshot returns an explicit outcome before any raw or normalized insert. (Test: `returns malformed without persistence when the bounded source payload is invalid`)
- **missing-level-raw-only**: A missing numeric level is retained as raw degraded evidence but cannot create a normalized claim. (Test: `retains a missing-level claim as raw degraded evidence without fabricating a normalized level`)
- **normalization-failure-state**: A post-raw normalization failure best-effort transitions the raw row to failed and preserves its diagnostic. (Test: `marks the raw row failed when normalization persistence fails`)
- **parsed-replay-idempotency**: An identical parsed replay reuses raw and normalized history and inserts no duplicates. (Test: `collapses an identical parsed replay without duplicate normalized rows`)
- **pending-failed-replay-recovery**: An identical pending or failed replay revalidates stored canonical content, restores normalized rows idempotently, and ends parsed. (Test: `recovers an identical pending or failed replay and transitions it to parsed`)
- **conflict-no-overwrite**: The same provider/run identity with a different raw hash returns conflict without overwriting history. (Test: `rejects a conflicting replay without overwriting history`)
- **within-run-equivalence-collapse**: Equivalent claims in one provider run yield one normalized row carrying a duplicate warning. (Test: `groups equivalent same-provider-run claims and records a duplicate warning`)
- **distinct-assertions-independent**: Provider, run, side, timeframe, or thesis differences remain independently persisted assertions. (Test: `preserves different providers runs sides timeframes and theses independently`)
- **stale-context-persistence**: Expired claims persist as stale allow_context_only evidence with warning and reduced confidence. (Test: `persists expired evidence as stale context-only evidence with degraded confidence`)
- **jsonb-round-trip**: Existing raw and normalized JSONB mappings preserve point/zone payload, confidence, freshness, and provenance without migration. (Test: `persists support resistance JSONB confidence freshness and provenance without a schema migration`)
- **normalized-uniqueness**: An identical normalized payload hash returns the existing row while a materially distinct payload remains independent. (Test: `returns the existing normalized row for an identical payload hash and keeps distinct payloads independent`)
