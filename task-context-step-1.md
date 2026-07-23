# Task Context: Task 1

Title: Define the support/resistance contract and taxonomy policy

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

## Repository Targets

### Expected Files

- src/contracts/taxonomy.ts
- src/contracts/support-resistance.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- tests/contracts/support-resistance.test.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/confidence.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts
pnpm exec eslint src/contracts/taxonomy.ts src/contracts/support-resistance.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/support-resistance.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/support-resistance.test.ts tests/domain/taxonomy/registry.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **point-zone-discrimination**: A normalized point has only one level value and a normalized zone has only ordered lower and upper bounds; neither shape silently converts to the other. (Test: `represents point and zone levels without silent conversion`)
- **contextual-taxonomy-authority**: Support/resistance is registered as contextual support_resistance evidence with allow_context_only stale behavior and technical-analysis-api provenance. (Test: `registers support resistance as contextual support_resistance evidence`)
