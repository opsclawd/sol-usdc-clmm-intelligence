<!-- plan-review-required -->

# Deterministic EvidenceBundle v1 Assembly and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble one strict, deterministic-only `evidence-bundle.v1` for an explicit SOL/USDC wallet/position/Whirlpool run context from persisted derived features and their verified lineage, validate and canonicalize it with the pinned Regime Engine contract, and persist it with exact-replay and immutable-conflict semantics.

**Architecture:** Vendor the exact Regime Engine schema and fixtures behind a version-specific contract port, while keeping feature selection, lineage verification, quality classification, and payload assembly pure and deterministic under `src/domain/evidence-bundle`. The application use case performs bounded repository reads, invokes those pure stages, validates before any write, and delegates one irreversible insert-or-classify operation to the Drizzle bundle adapter. A thin job and script bind explicit run inputs; there is no publisher, network retry loop, LLM call, policy synthesis, or execution authority.

**Tech Stack:** TypeScript 5.7, Zod, the JSON Schema draft validator and canonicalization implementation mandated by the pinned Regime Engine contract, Vitest, Drizzle ORM, PostgreSQL, pnpm, and dependency-cruiser.

---

**Hard prerequisite and current blocker**

The current `issue.md` still contains placeholders for the Regime Engine commit SHA, schema path, schema SHA-256, and valid fixture path, and supplies no canonical invalid, canonicalization, hash, or idempotency fixture paths. Do not start Task 1 until the issue records all of those values from merged `opsclawd/regime-engine#58`. The implementer must use the pinned files as the sole authority and must not infer fields, optional-section representations, quality formulas, canonical JSON rules, hash rules, or logical identity fields from `design.md` or this plan.

Before implementation, record the upstream repository, merged commit, source paths, schema version `evidence-bundle.v1`, and SHA-256 for every copied asset. Confirm that the pinned valid fixtures include a deterministic-only bundle with empty/unavailable contextual evidence and an absent research brief. If they do not, stop and request an upstream contract revision.

**Goals**

- Select exactly one deterministic snapshot for the seven existing MVP feature kinds using explicit pair, pool, position, accepted-calculator-version, evaluation-time, and run-context inputs.
- Preserve missing, partial, unavailable, expired, future, wrong-scope, and unsupported-version outcomes as explicit deterministic slot states and warnings; never synthesize zero.
- Verify raw → normalized → derived lineage, including the wallet/position/pool relationship in the lineage-linked clmm-v2 raw bundle.
- Produce the exact canonical payload text and SHA-256 required by Regime Engine, and persist those exact bytes alongside inspectable JSONB.
- Return `inserted`, `identical_replay`, or `conflict` deterministically without overwriting immutable evidence.
- Keep changed inputs, run identity, calculator/selection versions, and schema versions historically auditable.

**Non-goals**

- No HTTP publication, endpoint/auth configuration, retries, backoff, or publish-attempt rows.
- No contextual collectors, contextual inference, LLM research brief generation, or model calls.
- No Regime Engine selection/scoring, market regime classification, `PolicyInsight`, recommendation, or risk-policy changes.
- No new feature formulas, generic multi-pair bundle framework, UI behavior, wallet signing, transaction construction, swaps, or liquidity movement.
- No fallback local schema, local canonicalization convention, or intelligence-specific aggregate score when the upstream contract is silent.

**Affected files (repository-relative)**

- Contract assets and validation: `schemas/regime-engine/evidence-bundle.v1/schema.json`, `schemas/regime-engine/evidence-bundle.v1/provenance.json`, the exact pinned files under `schemas/regime-engine/evidence-bundle.v1/fixtures/`, `src/contracts/generated/evidence-bundle-v1.ts`, `src/contracts/evidence-bundle.ts`, `src/contracts/index.ts`, `src/ports/evidence-bundle-contract.ts`, `src/ports/index.ts`, `src/adapters/node/evidence-bundle-v1-contract.ts`, `tests/contracts/evidence-bundle-v1-contract.test.ts`, `tests/fixtures/evidence-bundle.ts`, `package.json`, `pnpm-lock.yaml`.
- Selection: `src/ports/feature-repo.ts`, `src/adapters/node/drizzle-feature-repo.ts`, `tests/fakes/fake-feature-repo.ts`, `src/domain/evidence-bundle/select.ts`, `src/domain/evidence-bundle/index.ts`, `tests/ports/feature-repo.test.ts`, `tests/domain/evidence-bundle/select.test.ts`.
- Lineage reads and verification: `src/ports/normalized-observation-repo.ts`, `src/adapters/node/drizzle-normalized-observation-repo.ts`, `tests/fakes/fake-normalized-observation-repo.ts`, `tests/ports/normalized-observation-repo.test.ts`, `src/ports/observation-repo.ts`, `src/adapters/node/drizzle-observation-repo.ts`, `tests/fakes/fake-observation-repo.ts`, `tests/ports/observation-repo.test.ts`, `src/domain/evidence-bundle/lineage.ts`, `tests/domain/evidence-bundle/lineage.test.ts`.
- Quality and assembly: `src/domain/evidence-bundle/quality.ts`, `src/domain/evidence-bundle/assemble.ts`, `src/domain/evidence-bundle/index.ts`, `tests/domain/evidence-bundle/quality.test.ts`, `tests/domain/evidence-bundle/assemble.test.ts`.
- Persistence: `src/db/schema/evidence-bundles.ts`, `drizzle/0003_evidence_bundle_v1.sql`, `drizzle/meta/0003_snapshot.json`, `drizzle/meta/_journal.json`, `tests/db/schema/evidence-bundles.test.ts`, `tests/db/migrations/evidence-bundle-v1.test.ts`, `src/ports/bundle-repo.ts`, `src/adapters/node/drizzle-bundle-repo.ts`, `tests/fakes/fake-bundle-repo.ts`, `tests/ports/bundle-repo.test.ts`, `tests/adapters/node/drizzle-bundle-repo.integration.test.ts`.
- Orchestration and operator surface: `src/application/assemble-evidence-bundle.ts`, `tests/application/assemble-evidence-bundle.test.ts`, `src/adapters/node/composition-root.ts`, `src/jobs/assemble-evidence-bundle-job.ts`, `src/jobs/index.ts`, `scripts/collectors/assemble-evidence-bundle.ts`, `tests/scripts/assemble-evidence-bundle.test.ts`, `package.json`, `README.md`, `docs/architecture.md`, `docs/operator-runbook.md`.

**Global implementation rules**

- Write every named invariant test first, run it and observe the expected failure, then add the minimum implementation and rerun the task-scoped checks.
- After each task, the implementation loop automatically runs `pnpm -r typecheck`; every port/interface task below therefore updates all implementations and fakes in that same task.
- Use only explicit request times. The use case and domain must not read the clock, environment, or generate a run ID.
- Sort and de-duplicate every contract-defined set/list before assembly. Do not sort arrays whose order is semantically mandated by the pinned fixtures.
- Compare expiration dynamically at assembly time using the upstream boundary rule; do not trust persisted `isStale` as the current-time decision.
- Validate the complete candidate before calling `EvidenceBundleRepo.insertOrClassify`.
- Commit each numbered task independently using the commit message shown in that task.

## Task 1: Pin the EvidenceBundle v1 contract and implement contract conformance

**Files:**

- Create: `schemas/regime-engine/evidence-bundle.v1/schema.json`
- Create: `schemas/regime-engine/evidence-bundle.v1/provenance.json`
- Create: exact upstream assets under `schemas/regime-engine/evidence-bundle.v1/fixtures/`
- Create: `src/contracts/generated/evidence-bundle-v1.ts`
- Create: `src/contracts/evidence-bundle.ts`
- Modify: `src/contracts/index.ts`
- Create: `src/ports/evidence-bundle-contract.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/evidence-bundle-v1-contract.ts`
- Create: `tests/contracts/evidence-bundle-v1-contract.test.ts`
- Create: `tests/fixtures/evidence-bundle.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Behavioral invariants (write these exact tests first):**

- `rejects contract assets whose bytes do not match the provenance manifest`: recompute SHA-256 for the schema and every fixture and fail before compiling the schema if any digest differs.
- `accepts every pinned canonical valid fixture`: every upstream valid fixture passes the declared JSON Schema draft without local exceptions.
- `rejects every pinned canonical invalid fixture`: every upstream invalid fixture fails validation for the upstream-defined reason/category.
- `accepts deterministic-only evidence with empty context and no research brief`: the canonical deterministic-only fixture validates without inventing contextual or LLM evidence.
- `canonicalizes and hashes byte-for-byte like Regime Engine`: canonical text and SHA-256 exactly match the pinned golden outputs, including nested key order, arrays, Unicode, integers, and any decimal cases present upstream.
- `derives the canonical idempotency identity exactly like Regime Engine`: fixture identity fields yield the pinned key and excluded payload fields do not alter it.
- `rejects unsupported schema versions before canonicalization`: any value other than the pinned `evidence-bundle.v1` version returns a typed contract error.

- [ ] **Step 1: Verify the contract gate.** Read the completed pin block in `issue.md`; verify the merged commit, exact paths, schema version, hashes, fixture coverage, license/repository policy, and deterministic-only semantics. Abort without modifying source files if any item is absent, ambiguous, mutable, or incompatible.
- [ ] **Step 2: Copy the exact upstream bytes and write provenance.** Preserve fixture bytes verbatim. In `provenance.json`, record `repository`, `commit`, `schemaPath`, `schemaVersion`, `copiedAt`, and an `assets` array of `{ sourcePath, localPath, sha256 }`. Do not normalize copied JSON before hashing.
- [ ] **Step 3: Generate the checked-in TypeScript type.** Generate `EvidenceBundleV1` from the pinned schema using a deterministic package script; the generated file must include its schema hash in a header and must not contain hand-edited fields. Add a drift check that regenerates to a temporary path and compares the result.
- [ ] **Step 4: Define the narrow contract port and typed errors.** Export `EvidenceBundleContract`, `CanonicalEvidenceBundle`, and `EvidenceBundleContractError`. The operation accepts `unknown`, validates it, returns the schema-typed payload plus exact canonical text/hash/idempotency key, and never selects evidence or calculates quality.

```ts
export interface CanonicalEvidenceBundle {
  readonly payload: EvidenceBundleV1;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly schemaVersion: "evidence-bundle.v1";
}

export interface EvidenceBundleContract {
  validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle>;
}
```

- [ ] **Step 5: Implement the Node contract adapter.** Compile the exact declared JSON Schema draft, reject unsupported formats/keywords rather than silently ignoring them, use the upstream-mandated canonicalization and identity algorithm, and hash the UTF-8 bytes of the returned canonical string. Reuse `src/domain/content-hash.ts` only if the golden fixtures prove exact equivalence; otherwise leave that existing helper unchanged and use the mandated algorithm solely in this adapter.
- [ ] **Step 6: Run focused conformance checks.** Expected: asset hashes, valid/invalid fixtures, deterministic-only fixture, canonical bytes, payload hashes, identity keys, generated-type drift, lint, and formatting all pass.

**Validation commands:**

```bash
pnpm exec vitest run tests/contracts/evidence-bundle-v1-contract.test.ts
pnpm exec eslint src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts --max-warnings 0
pnpm exec prettier --check schemas/regime-engine/evidence-bundle.v1 src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts package.json pnpm-lock.yaml
pnpm run contract:evidence-bundle:check
```

**Commit:** `feat: pin evidence bundle v1 contract`

## Task 2: Add bounded feature candidate reads and deterministic seven-slot selection

**Files:**

- Modify: `src/ports/feature-repo.ts`
- Modify: `src/adapters/node/drizzle-feature-repo.ts`
- Modify: `tests/fakes/fake-feature-repo.ts`
- Create: `src/domain/evidence-bundle/select.ts`
- Create: `src/domain/evidence-bundle/index.ts`
- Modify: `tests/ports/feature-repo.test.ts`
- Create: `tests/domain/evidence-bundle/select.test.ts`

**Behavioral invariants (write these exact tests first):**

- `returns only bounded SOL/USDC candidates for the seven requested kinds`: the adapter/fake coarse-filter by kinds, pair, inclusive minimum/maximum `asOfUnixMs`, and maximum `receivedAtUnixMs`, then return `(asOfUnixMs, receivedAtUnixMs, id)` ascending.
- `selects independently into exactly seven canonical slots`: output contains every `MVP_FEATURE_KINDS` member once in canonical order, even when no candidate exists.
- `selects the latest eligible row with a total tie break`: greatest `asOfUnixMs`, then greatest `receivedAtUnixMs`, then greatest database `id` wins regardless of repository return order.
- `rejects future and boundary-expired rows`: `asOfUnixMs > evaluationTimeUnixMs` is future, and the exact upstream expiry boundary from Task 1 determines expiration.
- `enforces pair pool and position scope by kind`: position features match pair+pool+position, volume/liquidity matches pair+pool with no position, and pair features match pair with neither pool nor position.
- `rejects unsupported calculator versions per feature kind`: only the request's exact version for that slot is eligible and unsupported-only is distinguishable from missing.
- `preserves partial and unavailable states without fabricating values`: `PARTIAL` keeps its legitimate numeric value; `UNAVAILABLE`, missing, expired-only, and unsupported-version-only have no numeric value.
- `preserves a legitimate numeric zero`: a selected `AVAILABLE` or `PARTIAL` value of `0` remains `0` and is not classified as missing.
- `produces stable rejection ids warnings and reasons`: candidate input permutations yield identical selected IDs and sorted/de-duplicated diagnostics.

- [ ] **Step 1: Add failing port and pure-selector tests.** Keep new selector cases in the new test file. In the existing 323-line port test, add only the bounded-query contract cases; this task is primarily a port/domain implementation task, not a broad rewrite of the existing test file.
- [ ] **Step 2: Add one query method and update all implementations atomically.** Add `listBundleCandidates(query)` to `DerivedFeatureRepo`, `DrizzleFeatureRepo`, and `FakeFeatureRepo` in this task. SQL remains a coarse bound only; do not encode semantic “winner” selection in the adapter.

```ts
export interface BundleFeatureCandidateQuery {
  readonly featureKinds: readonly FeatureKind[];
  readonly pair: "SOL/USDC";
  readonly asOfAtOrAfterUnixMs: number;
  readonly asOfAtOrBeforeUnixMs: number;
  readonly receivedAtOrBeforeUnixMs: number;
}

export interface DerivedFeatureRepo {
  // existing members remain
  listBundleCandidates(query: BundleFeatureCandidateQuery): Promise<DerivedFeatureRow[]>;
}
```

- [ ] **Step 3: Implement the pure selector.** Define `BundleSelectionRequest`, the six explicit slot outcomes (`selected_available`, `selected_partial`, `selected_unavailable`, `missing`, `expired_only`, `unsupported_version_only`), `SelectedFeatureSlot`, and `selectEvidenceFeatureSlots`. Validate non-empty identities, exact pair, exactly one accepted calculator version per required kind, supported assembly selection version, and coherent evaluation/creation times before selection.
- [ ] **Step 4: Run focused checks.** Expected: stable selection under candidate permutations and matching fake/Drizzle query semantics.

**Validation commands:**

```bash
pnpm exec vitest run tests/ports/feature-repo.test.ts tests/domain/evidence-bundle/select.test.ts
pnpm exec eslint src/ports/feature-repo.ts src/adapters/node/drizzle-feature-repo.ts tests/fakes/fake-feature-repo.ts src/domain/evidence-bundle/select.ts src/domain/evidence-bundle/index.ts tests/ports/feature-repo.test.ts tests/domain/evidence-bundle/select.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/feature-repo.ts src/adapters/node/drizzle-feature-repo.ts tests/fakes/fake-feature-repo.ts src/domain/evidence-bundle/select.ts src/domain/evidence-bundle/index.ts tests/ports/feature-repo.test.ts tests/domain/evidence-bundle/select.test.ts
```

**Commit:** `feat: select evidence bundle feature slots`

## Task 3: Add bulk normalized-observation lineage reads

**Files:**

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`
- Modify: `tests/ports/normalized-observation-repo.test.ts`

**Behavioral invariants (write these exact tests first):**

- `findByIds returns each requested normalized row once in id order`: duplicate and unordered IDs return unique existing rows sorted ascending by ID.
- `findByIds returns an empty list for an empty request`: the adapter performs no invalid `IN ()` query and the fake matches it.
- `findByIds omits unknown ids without substituting another row`: missing IDs remain detectable by the lineage verifier.

- [ ] **Step 1: Add the three failing contract cases** in a dedicated `findByIds` describe block in `tests/ports/normalized-observation-repo.test.ts`; do not restructure unrelated cases in this 605-line file.
- [ ] **Step 2: Add `findByIds(ids)` to the port, Drizzle adapter, and fake together.** Normalize IDs with ascending unique order before querying, use one bounded `inArray` query, and sort the returned rows by ID in both implementations.
- [ ] **Step 3: Run focused port checks.** Expected: the existing repository contract plus the new bulk-read block passes.

**Validation commands:**

```bash
pnpm exec vitest run tests/ports/normalized-observation-repo.test.ts -t "findByIds"
pnpm exec eslint src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/normalized-observation-repo.ts src/adapters/node/drizzle-normalized-observation-repo.ts tests/fakes/fake-normalized-observation-repo.ts tests/ports/normalized-observation-repo.test.ts
```

**Commit:** `feat: bulk load normalized lineage`

## Task 4: Add bulk raw-observation lineage reads

**Files:**

- Modify: `src/ports/observation-repo.ts`
- Modify: `src/adapters/node/drizzle-observation-repo.ts`
- Modify: `tests/fakes/fake-observation-repo.ts`
- Modify: `tests/ports/observation-repo.test.ts`

**Behavioral invariants (write these exact tests first):**

- `findByIds returns each requested raw row once in id order`: duplicate and unordered IDs return unique existing rows sorted ascending by ID.
- `findByIds returns an empty list for an empty request`: no invalid SQL is produced and the fake matches the adapter contract.
- `findByIds omits unknown ids without substituting another source identity`: unresolved raw parents remain visible to lineage verification.

- [ ] **Step 1: Add the failing contract cases** to `tests/ports/observation-repo.test.ts`.
- [ ] **Step 2: Add `findByIds(ids)` to `RawObservationRepo`, `DrizzleObservationRepo`, and `FakeObservationRepo` together.** Use the same sorted-unique input/output behavior as Task 3.
- [ ] **Step 3: Run focused checks.** Expected: all bulk raw-read cases pass with matching implementations.

**Validation commands:**

```bash
pnpm exec vitest run tests/ports/observation-repo.test.ts -t "findByIds"
pnpm exec eslint src/ports/observation-repo.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/observation-repo.ts src/adapters/node/drizzle-observation-repo.ts tests/fakes/fake-observation-repo.ts tests/ports/observation-repo.test.ts
```

**Commit:** `feat: bulk load raw lineage`

## Task 5: Verify feature lineage and requested wallet scope

**Files:**

- Create: `src/domain/evidence-bundle/lineage.ts`
- Modify: `src/domain/evidence-bundle/index.ts`
- Create: `tests/domain/evidence-bundle/lineage.test.ts`

**Behavioral invariants (write these exact tests first):**

- `accepts complete raw normalized and derived lineage for the requested context`: every selected feature reference resolves and the clmm-v2 raw bundle proves the requested pair, wallet, position, and pool relationship.
- `rejects a missing normalized reference`: a referenced normalized ID absent from the bulk result is a hard typed failure, not degraded coverage.
- `rejects a missing raw parent`: every resolved normalized row must have its exact raw parent.
- `rejects provenance id source or payload hash mismatches`: persisted row fields must match the corresponding feature provenance reference exactly.
- `rejects wallet position pool or pair contradictions`: a lineage-linked clmm-v2 payload that does not contain the requested relationship fails before assembly.
- `rejects invalid clmm-v2 canonical payload`: raw canonical text must parse as JSON and pass the existing `validateClmmBundle` contract before identity checks.
- `combines pair pool and position lineage in stable order`: duplicate raw, normalized, derived, and source refs collapse by canonical identity and sort according to the pinned bundle contract.
- `does not require numeric lineage for an explicit no-input unavailable slot`: a selected unavailable feature with contract-valid no-input provenance remains auditable through its reason codes.

- [ ] **Step 1: Create fixture-driven failing tests** using real `DerivedFeatureRow`, `NormalizedObservationRow`, and `RawObservationRow` shapes. Assert typed failure codes rather than incidental error prose.
- [ ] **Step 2: Implement `verifyEvidenceLineage`.** Accept the request, seven slots, and already-loaded rows; perform no I/O. Reuse the existing clmm-v2 validator, compare every provenance reference, and return the exact stable lineage/source-ref input required by the pinned contract.

```ts
export function verifyEvidenceLineage(input: VerifyEvidenceLineageInput): VerifiedEvidenceLineage;
```

- [ ] **Step 3: Run focused checks.** Expected: contradictory or incomplete lineage never produces a verified result.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/evidence-bundle/lineage.test.ts
pnpm exec eslint src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/lineage.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/lineage.test.ts
```

**Commit:** `feat: verify evidence bundle lineage`

## Task 6: Compute quality and assemble the canonical contract candidate

**Files:**

- Create: `src/domain/evidence-bundle/quality.ts`
- Create: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/domain/evidence-bundle/index.ts`
- Create: `tests/domain/evidence-bundle/quality.test.ts`
- Create: `tests/domain/evidence-bundle/assemble.test.ts`

**Behavioral invariants (write these exact tests first):**

- `classifies all seven fresh available slots as complete deterministic coverage`: deterministic coverage is complete, while overall coverage still records absent context and absent research brief exactly as the schema requires.
- `classifies one or multiple missing slots as partial without zero values`: missing slots carry canonical absence plus stable warnings.
- `classifies partial unavailable expired and unsupported slots distinctly`: each state contributes the upstream-mandated quality facts and warning codes.
- `refuses a zero-usable-feature bundle unless the pinned contract explicitly requires it`: the fail-closed result contains no candidate for persistence.
- `keeps bundle confidence monotonic with its usable evidence`: any aggregate required by the contract is reproducible and never exceeds the weakest summarized evidence under the pinned formula.
- `derives timestamps deterministically`: `asOf`, creation, and expiry follow the exact pinned rules, with creation supplied by immutable run context rather than an ambient clock.
- `normalizes warnings and references before mapping`: input permutations produce structurally identical candidates.
- `maps deterministic-only context and brief absence exactly`: contextual collections/sections and `researchBrief` use only the schema-authorized empty/unavailable/null representation.
- `maps exactly seven feature summaries in canonical order`: selected values, units, status, freshness, confidence, feature IDs, versions, and reasons use upstream field names without extra local fields.
- `does not include payload hash recursively unless the contract requires an envelope`: the candidate matches pinned valid fixtures before hashing.

- [ ] **Step 1: Add failing quality tests.** Encode the exact quality/coverage formula, warning vocabulary, timestamp boundary, confidence rounding, and zero-usable posture obtained from the pinned contract; do not create an intelligence-local score.
- [ ] **Step 2: Implement `classifyEvidenceBundleQuality`.** Make the rule version explicit and return only facts/fields defined by the generated contract.
- [ ] **Step 3: Add failing assembler tests.** Compare complete, missing, partial, unavailable, expired, empty-context, absent-brief, reordered-input, and zero-value cases to pinned or locally composed schema-valid fixtures.
- [ ] **Step 4: Implement `assembleEvidenceBundleCandidate`.** Accept only the validated request, seven selected slots, quality result, and verified lineage. Return `EvidenceBundleV1`-compatible data, but leave schema validation, canonicalization, hashing, and idempotency derivation to `EvidenceBundleContract`.

```ts
export function classifyEvidenceBundleQuality(input: EvidenceQualityInput): EvidenceBundleQuality;
export function assembleEvidenceBundleCandidate(
  input: AssembleEvidenceBundleInput
): EvidenceBundleV1;
```

- [ ] **Step 5: Run focused checks.** Expected: candidate structures validate in Task 1's contract tests and all permutations remain stable.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
pnpm exec eslint src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/evidence-bundle/quality.ts src/domain/evidence-bundle/assemble.ts src/domain/evidence-bundle/index.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/assemble.test.ts
```

**Commit:** `feat: assemble deterministic evidence bundle candidate`

## Task 7: Migrate evidence bundle storage for canonical bytes and logical identity

**Files:**

- Modify: `src/db/schema/evidence-bundles.ts`
- Modify: `src/db/schema/research-briefs.ts`
- Create: `drizzle/0003_evidence_bundle_v1.sql`
- Create: `drizzle/meta/0003_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/db/schema/evidence-bundles.test.ts`
- Create: `tests/db/migrations/evidence-bundle-v1.test.ts`

**Behavioral invariants (write these exact tests first):**

- `aborts before schema mutation when historical bundles exist`: migration raises an explicit exception if existing rows cannot be proven canonical; it never fabricates canonical text or identity keys.
- `never deletes rewrites or truncates historical bundles`: the migration contains no destructive data statement.
- `stores exact canonical payload text and idempotency identity as required fields`: lengths and nullability follow the pinned contract.
- `enforces one immutable row per canonical logical identity`: the unique index uses the exact schema/source/idempotency columns mandated upstream, not `(pair, payload_hash)`.
- `retains payload hash and inspectable jsonb`: `payload_hash` remains SHA-256-sized and `payload` remains non-null JSONB.
- `applies constraints only after the historical-row precondition`: abort logic precedes all `ALTER TABLE` and index changes.

- [ ] **Step 1: Add failing schema and migration tests.** Assert exact columns, types, index columns/order, check constraints, old-index disposition, precondition ordering, and absence of destructive data rewrites.
- [ ] **Step 2: Update the Drizzle schema.** Add `payloadCanonical`, `idempotencyKey`, and only the operational identity columns required by the pinned contract; replace `uniq_bundle_pair_hash` with the authoritative logical-identity uniqueness rule.
- [ ] **Step 3: Verify no FK changes required in `src/db/schema/research-briefs.ts`.** The foreign key at `research-briefs.ts:70` references `evidenceBundles.id` (the primary key), which is unchanged by this task. Confirm the FK constraint remains valid as-is and no modification to `research-briefs.ts` is needed. Add `src/db/schema/research-briefs.ts` to the task's `expected_files` to record this verification boundary.
- [ ] **Step 4: Generate migration metadata, then hand-author the safe precondition.** Use `pnpm db:generate` for schema metadata, inspect the generated SQL, and prepend an abort block before any mutation. Do not backfill unknown historical rows.
- [ ] **Step 5: Run focused schema/migration checks.** Expected: the migration proves fail-closed handling and matches Drizzle metadata.

**Validation commands:**

```bash
pnpm exec vitest run tests/db/schema/evidence-bundles.test.ts tests/db/migrations/evidence-bundle-v1.test.ts
pnpm exec eslint src/db/schema/evidence-bundles.ts tests/db/schema/evidence-bundles.test.ts tests/db/migrations/evidence-bundle-v1.test.ts --max-warnings 0
pnpm exec prettier --check src/db/schema/evidence-bundles.ts drizzle/0003_evidence_bundle_v1.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json tests/db/schema/evidence-bundles.test.ts tests/db/migrations/evidence-bundle-v1.test.ts
```

**Commit:** `feat: persist canonical evidence bundle identity`

## Task 8: Implement idempotent evidence bundle repository outcomes

**Files:**

- Modify: `src/ports/bundle-repo.ts`
- Modify: `src/adapters/node/drizzle-bundle-repo.ts`
- Modify: `tests/fakes/fake-bundle-repo.ts`
- Modify: `tests/ports/bundle-repo.test.ts`
- Create: `tests/adapters/node/drizzle-bundle-repo.integration.test.ts`

**Behavioral invariants (write these exact tests first):**

- `returns inserted for a new logical identity`: one immutable row is created with the exact canonical payload text and hash.
- `returns identical_replay for equal identity hash and canonical text`: the original row is returned and no field is updated.
- `returns conflict for equal identity with different hash`: the stored winner is preserved and both hashes are exposed in the typed outcome.
- `returns conflict for equal identity and hash with different canonical text`: a collision or inconsistent input cannot be mistaken for replay.
- `rejects jsonb that is not structurally equal to parsed canonical text`: storage consistency is checked before the insert attempt.
- `concurrent identical inserts converge on one immutable row`: one call inserts and the other classifies as replay.
- `concurrent conflicting inserts preserve one winner and report one conflict`: neither call overwrites the winner.
- `fails explicitly when the conflict winner disappears before reload`: concurrent deletion is an integrity error, not a replay.

- [ ] **Step 1: Replace the simple port tests with outcome tests.** The existing test file is small; cover inserted/replay/conflict and canonical/JSON consistency against the fake contract.
- [ ] **Step 2: Change the port and both implementations atomically.** Replace `insert` with `insertOrClassify`; add canonical payload and identity fields to row/insert shapes; retain existing read methods.

```ts
export type EvidenceBundleInsertOutcome =
  | { readonly outcome: "inserted"; readonly row: EvidenceBundleRow }
  | { readonly outcome: "identical_replay"; readonly row: EvidenceBundleRow }
  | {
      readonly outcome: "conflict";
      readonly row: EvidenceBundleRow;
      readonly incomingPayloadHash: string;
    };

export interface EvidenceBundleRepo {
  insertOrClassify(row: EvidenceBundleInsert): Promise<EvidenceBundleInsertOutcome>;
  findByPair(pair: string, sinceUnixMs: number): Promise<EvidenceBundleRow[]>;
  findLatestByPair(pair: string): Promise<EvidenceBundleRow | undefined>;
}
```

- [ ] **Step 3: Implement atomic Drizzle conflict classification.** Insert against the Task 7 logical unique index with `onConflictDoNothing`, reload by the full logical identity, compare schema version, idempotency key, payload hash, and canonical text, and return replay only for exact equality. Parse canonical text and recursively compare it with JSONB before attempting the write.
- [ ] **Step 4: Add isolated database integration coverage.** Create a dedicated bundle integration file rather than expanding the 364-line observation integration suite. Skip only when `TEST_DATABASE_URL` is absent, and cover sequential and concurrent outcomes.
- [ ] **Step 5: Run focused checks.** Expected: fake contract and real adapter classify all transitions identically.

**Validation commands:**

```bash
pnpm exec vitest run tests/ports/bundle-repo.test.ts tests/adapters/node/drizzle-bundle-repo.integration.test.ts
pnpm exec eslint src/ports/bundle-repo.ts src/adapters/node/drizzle-bundle-repo.ts tests/fakes/fake-bundle-repo.ts tests/ports/bundle-repo.test.ts tests/adapters/node/drizzle-bundle-repo.integration.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/bundle-repo.ts src/adapters/node/drizzle-bundle-repo.ts tests/fakes/fake-bundle-repo.ts tests/ports/bundle-repo.test.ts tests/adapters/node/drizzle-bundle-repo.integration.test.ts
```

**Commit:** `feat: classify evidence bundle replay conflicts`

## Task 9: Orchestrate validated assembly and persistence

**Files:**

- Create: `src/application/assemble-evidence-bundle.ts`
- Create: `tests/application/assemble-evidence-bundle.test.ts`

**Behavioral invariants (write these exact tests first):**

- `persists one schema-valid complete deterministic bundle`: bounded candidates, verified lineage, quality, assembly, contract validation, and insert occur in that order.
- `persists a schema-valid partial bundle with explicit missing warnings`: one and multiple missing features never become zero and still persist when at least one usable feature exists and the contract permits it.
- `preserves partial unavailable stale and nullable-brief semantics`: each acceptance-criteria case reaches the contract service with the exact canonical representation.
- `returns no_bundle when no feature is usable`: no contract or bundle repository write occurs unless the pinned contract explicitly mandates a durable unavailable bundle.
- `returns identical_replay without rebuilding mutable run context`: an explicit repeated request returns the original persisted row.
- `returns a typed conflict for same logical identity and different canonical content`: the use case never retries, overwrites, or hides the repository conflict.
- `persists nothing on invalid request lineage schema or canonicalization`: every hard failure occurs before `insertOrClassify`.
- `loads only lineage ids referenced by the selected slots`: bulk reads are bounded and unrelated observations do not enter the bundle.
- `does not call HTTP LLM publisher or policy dependencies`: the dependency object contains only feature, normalized, raw, bundle, and contract ports.

- [ ] **Step 1: Add failing orchestration tests** with recording fakes for call order and no-write assertions. Cover complete, one/multiple missing, partial, unavailable, expired, zero usable, invalid schema, corrupt lineage, exact replay, and conflict.
- [ ] **Step 2: Define and validate the explicit request.** Export `AssembleEvidenceBundleRequest`, `AssembleEvidenceBundleResult`, `AssembleEvidenceBundleError`, and `assembleEvidenceBundle`. The request contains exact pair, wallet, position, pool, run/correlation ID, evaluation time, creation time, accepted calculator versions, schema version, assembly selection version, and code version; it contains no ambient defaults.
- [ ] **Step 3: Implement the fail-closed flow.** Validate the request; query bounded feature candidates; select seven slots; collect referenced normalized IDs; bulk-load normalized rows; collect raw parents; bulk-load raw rows; verify lineage; classify quality; assemble the candidate; call `validateCanonicalizeAndHash`; map canonical/audit fields to `EvidenceBundleInsert`; then call `insertOrClassify` exactly once.
- [ ] **Step 4: Return stable outcomes.** Distinguish `persisted`, `identical_replay`, `no_bundle`, and typed hard errors/conflict. Include only row ID, hash, slot counts, warnings, and outcome in the result; do not expose or log wallet-sensitive payloads by default.
- [ ] **Step 5: Run focused checks.** Expected: all acceptance-criteria branches pass and no failed validation reaches persistence.

**Validation commands:**

```bash
pnpm exec vitest run tests/application/assemble-evidence-bundle.test.ts
pnpm exec eslint src/application/assemble-evidence-bundle.ts tests/application/assemble-evidence-bundle.test.ts --max-warnings 0
pnpm exec prettier --check src/application/assemble-evidence-bundle.ts tests/application/assemble-evidence-bundle.test.ts
```

**Commit:** `feat: assemble and persist evidence bundles`

## Task 10: Wire the runtime job, replay script, and operator documentation

**Files:**

- Modify: `src/adapters/node/composition-root.ts`
- Create: `src/jobs/assemble-evidence-bundle-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/assemble-evidence-bundle.ts`
- Create: `tests/scripts/assemble-evidence-bundle.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

**Behavioral invariants (write these exact tests first):**

- `runtime composes the bundle repository and pinned contract adapter`: `getPersistence()` supplies all five repositories and the runtime supplies the v1 contract service without eager database access.
- `job forwards an explicit immutable assembly request unchanged`: the job adds no clock, run ID, wallet, version, or timestamp defaults.
- `script parses required inputs and prints a redacted outcome summary`: output contains outcome, row ID when present, payload hash, coverage counts, and warning codes, but not wallet ID or canonical payload.
- `replaying the same input file preserves run and creation identity`: the script sends the same request bytes/values and permits `identical_replay`.
- `invalid input exits before database composition`: malformed JSON, missing required identity/version fields, or wrong pair produces a non-zero exit and no repository access.

- [ ] **Step 1: Add failing script/job boundary tests.** Invoke the script's exported `main` with fake dependencies and captured stdout/stderr; do not spawn a real process or database.
- [ ] **Step 2: Complete composition atomically.** Extend exported `Persistence` with `bundleRepo`, instantiate `DrizzleBundleRepo` in `getPersistence`, expose the `EvidenceBundleContract` from `NodeRuntime`, and instantiate the pinned adapter. Because `Persistence` and `NodeRuntime` are exported interfaces, update their implementation in this same task.
- [ ] **Step 3: Add the thin job and script.** The script accepts one repository-relative JSON request path, validates it through the application request parser, obtains persistence lazily, invokes the job once, emits redacted JSON, and sets a non-zero exit code for hard failure/conflict. Add `assemble:bundle` to `package.json`.
- [ ] **Step 4: Document contract provenance and replay.** In README/architecture/runbook, document the pinned schema commit/hash/update procedure, seven-slot selection and expiry rules, quality/coverage vocabulary, lineage verification, canonical hash/idempotency semantics, migration precondition, exact request-file example, exact replay behavior, redacted output, and the boundary that future publishing must send stored `payloadCanonical` without reassembly.
- [ ] **Step 5: Run focused checks.** Expected: script tests pass, runtime remains lazy, examples match the request/result types, and dependency boundaries remain valid for the new source paths.

**Validation commands:**

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec eslint src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts --max-warnings 0
pnpm exec prettier --check src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts package.json README.md docs/architecture.md docs/operator-runbook.md
pnpm exec depcruise --config .dependency-cruiser.cjs src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts
```

**Commit:** `feat: expose deterministic bundle assembly workflow`

**Tests added or updated**

- Contract conformance: pinned asset hashes, JSON Schema valid/invalid fixtures, deterministic-only validity, canonical bytes/hash/idempotency goldens, and generated-type drift.
- Pure domain: seven-slot selection, dynamic freshness, scope/version filtering, status/value handling, lineage integrity, stable ordering, quality/coverage, timestamps, confidence, empty context, absent brief, and canonical candidate mapping.
- Repository contracts: bounded feature reads, bulk normalized/raw lineage reads, exact replay/conflict classification, and JSONB/canonical-text consistency.
- Database: migration abort behavior, new columns/indexes/constraints, and concurrent identical/conflicting inserts.
- Application/script: complete and degraded assembly, no-usable stop, fail-before-write behavior, replay/conflict outcomes, explicit request forwarding, and redacted output.

**Risk areas**

- The upstream contract is not currently pinned; any implementation before that is contract invention.
- JSON canonicalization, Unicode, and decimal rendering can diverge across libraries even when parsed JSON is equivalent; golden byte/hash fixtures are mandatory.
- Historical `evidence_bundles` rows cannot safely receive fabricated canonical text or identity keys; the migration intentionally aborts when they exist unless a separately approved data migration proves them.
- Wallet identity exists only in raw clmm-v2 payload lineage, so trusting the request alone could create cross-wallet evidence.
- Persisted `isStale` reflects derivation time and can be wrong at later assembly time; expiration must be evaluated again.
- Candidate query bounds must be broad enough to retain expired-only and unsupported-version-only diagnostics while remaining operationally bounded.
- Concurrent insert classification depends on the exact logical unique index and a reliable winner reload; a disappearing winner is an integrity failure.
- Canonical payloads and wallet/position identifiers are sensitive; CLI output and errors must stay redacted.
- Partial bundle persistence must follow both the pinned schema and repository fail-closed posture; zero usable evidence defaults to no bundle.

**Stop conditions**

- Abort before Task 1 if `issue.md` lacks the merged Regime Engine SHA, exact schema/fixture paths, schema version, and SHA-256 values, or if those assets cannot be copied under repository policy.
- Abort if the pinned schema/fixtures do not validate deterministic-only bundles with canonical contextual absence and no research brief.
- Abort if canonicalization, payload hashing, idempotency identity, timestamp boundaries, or any required aggregate quality/confidence formula is not unambiguously specified and fixture-covered upstream.
- Abort if copied asset hashes differ from the issue pin or generated types cannot represent the deterministic-only fixture exactly.
- Abort the migration if historical `evidence_bundles` rows exist and no separately approved, provably correct canonical backfill is supplied.
- Abort assembly before persistence on invalid request identity, unsupported schema/version configuration, zero usable evidence (unless upstream explicitly mandates persistence), missing/corrupt lineage, wallet/position/pool contradiction, schema validation failure, canonicalization failure, or JSONB/canonical-text mismatch.
- Abort rather than overwrite on same logical identity with different canonical content, and abort rather than retry on database integrity failures in this issue.

**Plan review classification**

This plan requires review because it introduces an irreversible database write and explicit inserted/replay/conflict state transitions. The first-line `plan-review-required` marker is therefore present.
