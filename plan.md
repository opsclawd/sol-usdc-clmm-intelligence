# Contract-Compliant Evidence Bundle Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assembled SOL/USDC evidence bundles pass the pinned `evidence-bundle.v1` contract when deterministic features have mixed availability and contextual evidence or a research brief is absent.

**Architecture:** Keep completeness assessment in `src/domain/evidence-bundle/quality.ts`, where the existing `contextPresent` and `briefPresent` facts are already classified. Keep lineage assembly in `src/domain/evidence-bundle/assemble.ts`: usable deterministic features reference the assembled bundle's source references, while unavailable features reference one canonical `internal_bundle` source. Validate each behavior at the domain boundary and validate their combined result with the real pinned contract adapter.

**Tech Stack:** TypeScript 5.7, Vitest 2, the generated `EvidenceBundleV1` contract types, and the AJV-backed pinned Regime Engine contract adapter.

---

**Goal details**

The completed change must remove the two known `CONTRACT_ERROR` causes:

- Every deterministic feature `inputLineage` entry resolves to a `sourceReferences[].referenceId` in the same candidate.
- Empty contextual evidence is accompanied by `CONTEXTUAL_EVIDENCE_UNAVAILABLE`.
- A `null` research brief is accompanied by `RESEARCH_BRIEF_UNAVAILABLE`.
- A mixed available/unavailable bundle produced from realistic lineage passes `createEvidenceBundleContract().validateCanonicalizeAndHash(...)`.

**Non-goals**

- Do not change database schemas, repository ports, adapter interfaces, generated contract types, or pinned schema assets.
- Do not add precise feature-to-raw-observation lineage mapping; usable features intentionally receive the bundle-wide source-reference set selected by the design.
- Do not expose internal derived-feature row IDs as contract lineage references.
- Do not change feature selection, lineage verification, quality-level calculation, coverage calculation, research-brief generation, publication, or policy interpretation.
- Do not add scheduling for `assemble:bundle` or perform live database/deployment verification as part of implementation.
- Do not regenerate `src/contracts/generated/evidence-bundle-v1.ts` or modify anything under `schemas/regime-engine/`.

**Assumptions**

- `VerifiedEvidenceLineage.lineage.sourceReferences` is already deduplicated and deterministically ordered by the upstream lineage verifier.
- Evaluation windows normally contain no more than 64 source references, matching the `inputLineage` maximum in the pinned contract.
- `internal_bundle` remains an allowed `SourceReference.sourceType`; this is confirmed by the checked-in generated contract.
- The canonical unavailable reference uses `referenceId: "feature_unavailable"`, `locator: "unavailable"`, and the bundle `asOf` timestamp as its deterministic `observedAt`.
- Existing coverage values (`not_applicable` when context or brief is absent) remain unchanged because the reported defect concerns required warnings, not coverage semantics.

**Affected files**

| Path from repository root                       | Responsibility                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/domain/evidence-bundle/quality.ts`         | Emit contract-required warnings from the existing context/brief presence facts.                    |
| `tests/domain/evidence-bundle/quality.test.ts`  | Lock the warning presence/absence truth table and exact warning payloads.                          |
| `src/domain/evidence-bundle/assemble.ts`        | Build resolvable usable/unavailable feature lineage and register the canonical unavailable source. |
| `tests/domain/evidence-bundle/assemble.test.ts` | Lock lineage mapping and validate a mixed candidate with the real pinned contract adapter.         |

**Behavioral invariants**

- `contextPresent === false` always yields exactly one warning with code `CONTEXTUAL_EVIDENCE_UNAVAILABLE`; `contextPresent === true` yields none with that code.
- `briefPresent === false` always yields exactly one warning with code `RESEARCH_BRIEF_UNAVAILABLE`; `briefPresent === true` yields none with that code.
- Existing slot-quality warnings remain present and keep their existing order; required absence warnings are appended in contextual-then-brief order.
- `selected_available` and `selected_partial` features receive the non-empty list of verified or fallback source-reference IDs, excluding the unavailable placeholder.
- `missing`, `selected_unavailable`, `expired_only`, and `unsupported_version_only` features receive only `["feature_unavailable"]`.
- `feature_unavailable` is registered exactly once when at least one unavailable feature is assembled and is omitted when all features are usable.
- No emitted `inputLineage` value uses the legacy `row-N` or `missing` sentinel.

**Tests to add or update**

- In the existing context/brief describe-block of `tests/domain/evidence-bundle/quality.test.ts`, replace the obsolete zero-warning expectation and add focused cases for absent, present, and context-present/brief-absent inputs.
- In the existing feature-mapping/missing-slot area of `tests/domain/evidence-bundle/assemble.test.ts`, add focused assertions for usable and unavailable lineage plus conditional placeholder registration.
- In `tests/domain/evidence-bundle/assemble.test.ts`, add one contract regression that assembles mixed feature outcomes with two realistic `raw-N` source references, no context, and no brief, then calls the real `createEvidenceBundleContract()` adapter. This test must fail on the pre-fix code with unresolved lineage and missing-warning errors.

## Task 1: Emit required context and research-brief warnings

**Files:**

- Modify: `tests/domain/evidence-bundle/quality.test.ts` — only the `classifies all seven fresh available slots...` and `maps deterministic-only context and brief absence exactly` describe-blocks.
- Modify: `src/domain/evidence-bundle/quality.ts` — only `buildWarnings(...)`.

**Reference files:**

- Read only: `schemas/regime-engine/evidence-bundle.v1/fixtures/valid/deterministic-only.json` for the canonical codes, messages, and affected-family names.
- Read only: `src/adapters/node/evidence-bundle-v1-contract.ts` for the empty-context and null-brief cross-field checks.

**Behavioral invariants and named tests:**

1. **Both absence warnings:** Given `contextPresent: false` and `briefPresent: false`, append both required warnings with their exact canonical payloads.
   Test first: `emits required contract warnings when context and brief are absent`.
2. **No false absence warnings:** Given `contextPresent: true` and `briefPresent: true`, emit neither required warning.
   Test first: `omits required absence warnings when context and brief are present`.
3. **Independent brief warning:** Given `contextPresent: true` and `briefPresent: false`, emit `RESEARCH_BRIEF_UNAVAILABLE` but not `CONTEXTUAL_EVIDENCE_UNAVAILABLE`.
   Test first: `emits only the research brief warning when context exists without a brief`.
4. **Stable required-warning composition:** The two new warnings appear at most once and in contextual-then-brief order because `buildWarnings` executes each absence branch once.
   Covered by the exact warning-code array assertion in the first test.

- [ ] **Step 1: Write the failing warning truth-table tests**

Update the obsolete assertion in the complete-deterministic-coverage case so it no longer expects an empty warning list when both optional evidence classes are absent. In the existing `maps deterministic-only context and brief absence exactly` describe-block, add focused tests using this shape:

```ts
it("emits required contract warnings when context and brief are absent", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: false,
      briefPresent: false
    })
  );

  expect(result.warnings.map((warning) => warning.code)).toEqual([
    "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    "RESEARCH_BRIEF_UNAVAILABLE"
  ]);
  expect(result.warnings).toContainEqual({
    code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    message: "All contextual evidence families are unavailable",
    affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
  });
  expect(result.warnings).toContainEqual({
    code: "RESEARCH_BRIEF_UNAVAILABLE",
    message: "Research brief is null",
    affectedFamilies: ["researchBrief"]
  });
});

it("omits required absence warnings when context and brief are present", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: true,
      briefPresent: true
    })
  );

  expect(
    result.warnings.filter(
      (warning) =>
        warning.code === "CONTEXTUAL_EVIDENCE_UNAVAILABLE" ||
        warning.code === "RESEARCH_BRIEF_UNAVAILABLE"
    )
  ).toEqual([]);
});

it("emits only the research brief warning when context exists without a brief", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: true,
      briefPresent: false
    })
  );

  expect(result.warnings.map((warning) => warning.code)).toEqual(["RESEARCH_BRIEF_UNAVAILABLE"]);
});
```

- [ ] **Step 2: Run only the new warning cases and confirm the pre-fix failure**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts -t "emits required contract warnings|omits required absence warnings|emits only the research brief warning"
```

Expected before implementation: the absence cases fail because `buildWarnings` does not use `contextPresent` or `briefPresent`; the present/present case may already pass.

- [ ] **Step 3: Implement the minimal quality warning branches**

Append the required warnings in `buildWarnings(...)` after the existing slot-status warning branches and before returning:

```ts
if (!contextPresent) {
  warnings.push({
    code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    message: "All contextual evidence families are unavailable",
    affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
  });
}

if (!briefPresent) {
  warnings.push({
    code: "RESEARCH_BRIEF_UNAVAILABLE",
    message: "Research brief is null",
    affectedFamilies: ["researchBrief"]
  });
}
```

Do not change `computeQualityLevel`, `computeOverallConfidence`, or the `coverage` object. The new warnings communicate absence without redefining those existing outputs.

- [ ] **Step 4: Run task-scoped tests and static checks**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts
pnpm exec eslint src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
pnpm exec prettier --check src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
```

Expected: the quality test file passes; ESLint and Prettier report no errors. The implementation loop's automatic `pnpm -r typecheck` gate must also pass.

- [ ] **Step 5: Commit the warning behavior**

```bash
git add src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
git commit -m "fix: emit required evidence absence warnings"
```

Acceptance criteria:

- Both false flags produce both exact canonical warning payloads.
- Each true flag suppresses only its corresponding absence warning.
- Existing slot warning tests remain green.
- No exported API signature changes.

## Task 2: Resolve deterministic feature lineage against bundle sources

**Files:**

- Modify: `tests/domain/evidence-bundle/assemble.test.ts` — only helper setup needed for realistic lineage, the deterministic feature mapping/missing-slot describe-blocks, and one focused strict-contract regression describe-block.
- Modify: `src/domain/evidence-bundle/assemble.ts` — `buildDeterministicFeature(...)`, source-reference construction helpers, and local ordering inside `assembleEvidenceBundleCandidate(...)`.

**Reference files:**

- Read only: `src/domain/evidence-bundle/lineage.ts` for `VerifiedLineageSourceRef` semantics and upstream `raw-N` reference construction.
- Read only: `src/domain/evidence-bundle/quality.ts` for production classification used by the strict-contract regression.
- Read only: `src/contracts/generated/evidence-bundle-v1.ts` for `Identifier128`, `SourceReference`, non-empty `inputLineage`, and maximum sizes.
- Read only: `src/adapters/node/evidence-bundle-v1-contract.ts` for strict unresolved-lineage and required-warning checks.
- Read only: `schemas/regime-engine/evidence-bundle.v1/fixtures/valid/deterministic-only.json` for a contract-valid deterministic-only example.

**Behavioral invariants and named tests:**

1. **Usable lineage:** For `selected_available` or `selected_partial`, `inputLineage` equals every verified or fallback source-reference ID assembled before the unavailable placeholder, in the same deterministic order.
   Test first: `maps available and partial features to every verified source reference`.
2. **Unavailable lineage:** For `missing`, `selected_unavailable`, `expired_only`, or `unsupported_version_only`, `inputLineage` is exactly `["feature_unavailable"]`.
   Test first: `maps every unavailable feature outcome to the canonical unavailable reference`.
3. **Conditional placeholder registration:** If any feature is unavailable, register one `feature_unavailable` `internal_bundle` source observed at bundle `asOf`; if every feature is usable, do not register it.
   Test first: `registers the unavailable source exactly once only when it is needed`.
4. **Contract-level closure:** A mixed candidate with valid `raw-N` sources, empty context, and a null brief passes strict validation and canonicalization with no unresolved lineage or missing-warning errors.
   Test first: `passes strict contract validation for mixed availability without context or a brief`.
5. **Non-empty fallback:** If verified lineage has no external source references, usable features continue to reference the existing `no_sources_available` source rather than receiving an empty lineage array.
   Test first: `uses the existing no-sources reference for usable features when lineage is empty`.

- [ ] **Step 1: Add the contract adapter import and realistic lineage test helper**

Add the real adapter import to `tests/domain/evidence-bundle/assemble.test.ts`:

```ts
import { createEvidenceBundleContract } from "../../../src/adapters/node/evidence-bundle-v1-contract.js";
import { classifyEvidenceBundleQuality } from "../../../src/domain/evidence-bundle/quality.js";
```

Extend the local lineage helper without changing production types:

```ts
function makeLineage(
  sourceReferences: VerifiedEvidenceLineage["lineage"]["sourceReferences"] = []
): VerifiedEvidenceLineage["lineage"] {
  return {
    rawObservationIds: sourceReferences.map((reference, index) => {
      const rawId = Number(reference.referenceId.replace(/^raw-/, ""));
      return Number.isFinite(rawId) ? rawId : index + 1;
    }),
    normalizedObservationIds: [],
    sourceReferences
  };
}

const RAW_SOURCE_REFERENCES: VerifiedEvidenceLineage["lineage"]["sourceReferences"] = [
  {
    referenceId: "raw-10",
    sourceType: "api",
    locator: "jupiter:SOL-USDC",
    observedAt: "2026-07-28T18:00:00.000Z"
  },
  {
    referenceId: "raw-20",
    sourceType: "chain",
    locator: "orca:pool-abc",
    observedAt: "2026-07-28T18:00:01.000Z"
  }
];
```

Keep the helper deterministic and local to the test file. Do not alter `VerifiedEvidenceLineage` or its port-facing consumers.

- [ ] **Step 2: Write the failing usable and unavailable lineage tests**

Create a local mixed-slot factory in the test file. All usable slots must have contract-valid `asOfUnixMs` and `validUntilUnixMs`; explicitly cover available, partial, missing, selected-unavailable, expired-only, and unsupported-version-only outcomes:

```ts
function makeMixedSlots(asOfUnixMs: number, freshUntilUnixMs: number): SelectedFeatureSlot[] {
  return MVP_FEATURE_KINDS.map((featureKind, index) => {
    if (index === 2) return { featureKind, outcome: "missing" as const };
    if (index === 3) {
      return {
        featureKind,
        outcome: "selected_unavailable" as const,
        rowId: index + 1,
        confidence: { ...DEFAULT_CONFIDENCE, compositeScore: 0 },
        provenance: DEFAULT_PROVENANCE,
        warnings: ["no_valid_input"],
        reasons: ["input_exhausted"],
        asOfUnixMs,
        validUntilUnixMs: freshUntilUnixMs
      };
    }
    if (index === 4) {
      return { featureKind, outcome: "expired_only" as const, rowId: index + 1 };
    }
    if (index === 5) {
      return {
        featureKind,
        outcome: "unsupported_version_only" as const,
        rowId: index + 1
      };
    }
    return {
      featureKind,
      outcome: index === 1 ? ("selected_partial" as const) : ("selected_available" as const),
      rowId: index + 1,
      value: 1000 + index,
      confidence: DEFAULT_CONFIDENCE,
      provenance: DEFAULT_PROVENANCE,
      warnings: [] as readonly string[],
      reasons: [] as readonly string[],
      asOfUnixMs,
      validUntilUnixMs: freshUntilUnixMs
    };
  });
}
```

Add the named unit tests. Their core assertions must be:

```ts
const usableFeatures = result.deterministicFeatures.filter(
  (feature) => feature.status === "available"
);
expect(usableFeatures.map((feature) => feature.inputLineage)).toEqual(
  usableFeatures.map(() => ["raw-10", "raw-20"])
);

const unavailableFeatures = result.deterministicFeatures.filter(
  (feature) => feature.status === "unavailable"
);
expect(unavailableFeatures.map((feature) => feature.inputLineage)).toEqual(
  unavailableFeatures.map(() => ["feature_unavailable"])
);

expect(
  result.sourceReferences.filter((reference) => reference.referenceId === "feature_unavailable")
).toEqual([
  {
    referenceId: "feature_unavailable",
    sourceType: "internal_bundle",
    locator: "unavailable",
    observedAt: new Date(asOfUnixMs).toISOString()
  }
]);
```

Also assemble an all-usable candidate and assert that `feature_unavailable` is absent. Assemble an all-usable candidate with `makeLineage()` and assert every feature uses `["no_sources_available"]`.

- [ ] **Step 3: Write the failing strict-contract regression**

Use the same mixed slots and realistic lineage, but derive the quality object with the production classifier so Task 1's warning behavior is included:

```ts
it("passes strict contract validation for mixed availability without context or a brief", async () => {
  const asOfUnixMs = Date.parse("2026-07-28T18:00:02.000Z");
  const freshUntilUnixMs = Date.parse("2026-07-28T19:00:02.000Z");
  const expiresAtUnixMs = Date.parse("2026-07-28T20:00:02.000Z");
  const slots = makeMixedSlots(asOfUnixMs, freshUntilUnixMs);
  const quality = classifyEvidenceBundleQuality({
    slots,
    runId: "run-contract-regression",
    correlationId: "corr-contract-regression",
    createdAt: asOfUnixMs,
    asOf: asOfUnixMs,
    freshUntil: freshUntilUnixMs,
    expiresAt: expiresAtUnixMs,
    contextPresent: false,
    briefPresent: false
  });
  const candidate = assembleEvidenceBundleCandidate(
    makeAssembleInput(slots, quality, makeLineage(RAW_SOURCE_REFERENCES), {
      runId: "run-contract-regression",
      correlationId: "corr-contract-regression",
      createdAt: asOfUnixMs,
      asOf: asOfUnixMs,
      freshUntil: freshUntilUnixMs,
      expiresAt: expiresAtUnixMs,
      contextPresent: false,
      briefPresent: false,
      gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234"
    })
  );

  await expect(
    createEvidenceBundleContract().validateCanonicalizeAndHash(candidate)
  ).resolves.toMatchObject({
    schemaVersion: "evidence-bundle.v1"
  });
});
```

This is the acceptance-level regression. It must use the real adapter, not a fake contract, so both cross-reference checks execute.

- [ ] **Step 4: Run only the new lineage/contract cases and confirm the pre-fix failures**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/assemble.test.ts -t "maps available and partial features|maps every unavailable feature outcome|registers the unavailable source|uses the existing no-sources reference|passes strict contract validation"
```

Expected before implementation:

- Usable features expose `row-N` instead of `raw-10`/`raw-20`.
- Unavailable features expose `missing` or `row-N` instead of `feature_unavailable`.
- No matching `feature_unavailable` source exists.
- The strict contract case rejects with unresolved-lineage validation errors.

- [ ] **Step 5: Thread the assembled source IDs into deterministic feature construction**

Add a module-local identifier constant:

```ts
const FEATURE_UNAVAILABLE_REFERENCE_ID =
  "feature_unavailable" as import("../../contracts/generated/evidence-bundle-v1.js").Identifier128;
```

Change only the private `buildDeterministicFeature` signature:

```ts
function buildDeterministicFeature(
  slot: SelectedFeatureSlot,
  featureKind: FeatureKind,
  availableInputLineage: [
    import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
    ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
  ]
): DeterministicFeature;
```

Use the supplied `availableInputLineage` only for `selected_available` and `selected_partial`. Use this tuple for every branch that maps to contract status `unavailable`:

```ts
const unavailableInputLineage = [FEATURE_UNAVAILABLE_REFERENCE_ID] as [
  import("../../contracts/generated/evidence-bundle-v1.js").Identifier128
];
```

Remove the legacy `["missing"]` and ``[`row-${rowId}`]`` assignments. Keep `rowId` only in `featureId`; it remains useful identity data but is no longer contract lineage.

- [ ] **Step 6: Register the canonical unavailable source and build features in dependency order**

Inside `assembleEvidenceBundleCandidate(...)`, build source references before mapping features:

```ts
const sourceReferences = buildSourceReferences(lineage);
const availableInputLineage = sourceReferences.map((reference) => reference.referenceId) as [
  import("../../contracts/generated/evidence-bundle-v1.js").Identifier128,
  ...import("../../contracts/generated/evidence-bundle-v1.js").Identifier128[]
];
```

Pass `availableInputLineage` to every `buildDeterministicFeature(...)` call, including synthesized missing slots. After feature mapping, conditionally append one placeholder:

```ts
const needsUnavailableReference = deterministicFeatures.some((feature) =>
  feature.inputLineage.includes(FEATURE_UNAVAILABLE_REFERENCE_ID)
);

if (needsUnavailableReference) {
  sourceReferences.push({
    referenceId: FEATURE_UNAVAILABLE_REFERENCE_ID,
    sourceType: "internal_bundle",
    locator: "unavailable",
    observedAt: toCanonicalTimestamp(asOf)
  });
}
```

Return the already-built `sourceReferences` variable rather than invoking `buildSourceReferences(lineage)` a second time. This preserves the existing `no_sources_available` fallback and ensures all feature lineage IDs resolve against the exact returned array.

- [ ] **Step 7: Run task-scoped tests and static checks**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/assemble.test.ts
pnpm exec eslint src/domain/evidence-bundle/assemble.ts tests/domain/evidence-bundle/assemble.test.ts
pnpm exec prettier --check src/domain/evidence-bundle/assemble.ts tests/domain/evidence-bundle/assemble.test.ts
```

Expected: both domain test files pass, including strict canonicalization; ESLint and Prettier report no errors. The implementation loop's automatic `pnpm -r typecheck` gate must also pass.

- [ ] **Step 8: Commit the lineage and contract regression**

```bash
git add src/domain/evidence-bundle/assemble.ts tests/domain/evidence-bundle/assemble.test.ts
git commit -m "fix: resolve assembled feature lineage"
```

Acceptance criteria:

- Every usable feature references the exact assembled verified-source ID list.
- Every unavailable feature references only the registered canonical placeholder.
- The placeholder appears exactly once only when needed.
- Empty verified lineage remains schema-valid via `no_sources_available`.
- The real contract accepts the mixed-availability, no-context, no-brief candidate.
- No exported API signature changes.

**Validation commands summary**

Each task contains its own path-scoped Vitest, ESLint, and Prettier commands. The implementation orchestrator additionally runs its automatic workspace typecheck gate after each task and its dedicated validation phase after all implementation tasks; do not create another task for those suite runs.

**Risk areas**

- Bundle-wide lineage is intentionally less precise than feature-specific lineage. If downstream consumers require exact raw-source attribution per feature, stop and redesign `VerifiedEvidenceLineage` rather than implying precision.
- `inputLineage` allows at most 64 entries while `sourceReferences` allows 256. The selected design assumes bounded evaluation windows. Do not silently truncate or reorder lineage because that would weaken auditability.
- The placeholder must not leak into usable-feature lineage. Build usable lineage before conditionally appending `feature_unavailable`.
- All unavailable domain outcomes map to contract status `unavailable`; missing any branch would leave an unresolved `row-N` or `missing` sentinel.
- Warning codes are case-sensitive contract identifiers. Use the exact uppercase codes and the canonical affected-family spellings.
- `buildBundleAssessment` copies warnings from the quality result. Do not duplicate warning injection in assembly, which could produce inconsistent behavior between quality consumers.
- `tests/domain/evidence-bundle/assemble.test.ts` exceeds 500 lines. Keep Task 2 edits confined to the listed helpers and focused describe-blocks; do not refactor unrelated cases.

**Stop conditions**

- Stop if realistic lineage can exceed 64 source references in a normal evaluation window; the global-source design would violate the contract and needs a different design decision.
- Stop if the pinned schema or real adapter rejects `internal_bundle` for `feature_unavailable`; do not substitute an external source type.
- Stop if regime-engine requires exact feature-to-raw-source attribution; that expands scope into `VerifiedEvidenceLineage` and must be designed separately.
- Stop if passing the strict regression requires changing pinned schema assets, generated contract types, database schemas, or exported ports/interfaces.
- Stop and report any unrelated pre-existing test, lint, formatting, or typecheck failure; do not broaden either task into general cleanup.
- Stop if a contract-valid mixed candidate requires changing quality or coverage semantics beyond adding the two specified warnings.
