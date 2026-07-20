# Task Context: Task 1

Title: Define the seven feature kinds and validated result contract

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-25
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-25
Start Commit: 72198d814d2ef33860d879741b7b7acc3b54e679

## Task Requirements

**Files:**

- Create: `src/contracts/derived-feature.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Create: `tests/domain/derived-feature/contract.test.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`
- Modify: `tests/domain/taxonomy/validation.test.ts`
- Modify: `tests/ports/feature-repo.test.ts`
- Modify: `tests/db/schema/derived-features.test.ts`

**Behavioral invariants (write these tests first):**

- `accepts an AVAILABLE feature only with a finite safe-integer value`: `AVAILABLE` requires a non-null finite safe integer; `UNAVAILABLE` requires `null`; `PARTIAL` requires a non-null finite safe integer.
- `enforces the canonical unit for every feature kind`: range location and volume/liquidity use `PPM`; the other five kinds use `BPS`.
- `enforces feature scope identity by kind`: position features require both `poolId` and `positionId`; pool ratio requires `poolId` and no `positionId`; pair features require neither position identity.
- `rejects unsorted duplicate observation ids and reason codes`: selected/rejected IDs and warning/reason arrays are strictly sorted and unique.
- `accepts unavailable no-input provenance only with a stable reason`: ref-free provenance is allowed only for `UNAVAILABLE` with at least one reason; available/partial rows must satisfy registry ref minima.
- `rejects removed placeholder feature kinds`: `fee_apr`, `oracle_divergence`, `volatility_24h`, and `liquidity_depth` no longer parse.
- `tests/ports/feature-repo.test.ts and tests/db/schema/derived-features.test.ts reference the seven canonical kinds`: both test files must be updated in Task 1 to use `range_location`, `distance_to_lower`, `distance_to_upper`, `oracle_dex_divergence`, `oracle_confidence_width`, `realized_volatility_1h`, and `volume_liquidity_ratio_24h`; they must not reference the removed placeholder kinds or defer type fixes to Tasks 8 or 9.

- [ ] **Step 1: Add failing contract and taxonomy tests.** Assert the exact seven-member set, registry families/source allowlists/freshness policies, kind-to-unit/scope rules, status/value rules, timestamps, schema version, version strings, confidence/freshness, sorted identities, metadata, and status-aware provenance. Also update `tests/ports/feature-repo.test.ts` and `tests/db/schema/derived-features.test.ts` to reference only the seven canonical feature kinds; this update must happen in Task 1, not deferred to Tasks 8 or 9, to keep `pnpm -r typecheck` green after each task.

- [ ] **Step 2: Define and export the result contract.** Use a Zod-backed runtime parser with the following public shape; keep warnings/reasons as stable snake-case strings and metadata JSON-compatible.

```ts
export const MVP_FEATURE_KINDS = [
  "range_location",
  "distance_to_lower",
  "distance_to_upper",
  "oracle_dex_divergence",
  "oracle_confidence_width",
  "realized_volatility_1h",
  "volume_liquidity_ratio_24h"
] as const;

export type FeatureStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type FeatureUnit = "BPS" | "PPM";

export interface DerivedFeatureV1 {
  readonly schemaVersion: 1;
  readonly featureKind: FeatureKind;
  readonly status: FeatureStatus;
  readonly value: number | null;
  readonly unit: FeatureUnit;
  readonly pair: "SOL/USDC";
  readonly poolId: string | null;
  readonly positionId: string | null;
  readonly asOfUnixMs: number;
  readonly expiresAtUnixMs: number;
  readonly confidence: Confidence;
  readonly freshness: Freshness;
  readonly inputObservationIds: readonly number[];
  readonly rejectedObservationIds: readonly number[];
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly calculatorVersion: string;
  readonly selectionVersion: string;
  readonly calculationMetadata: Readonly<Record<string, unknown>>;
}

export function parseDerivedFeatureV1(value: unknown): DerivedFeatureV1;
```

- [ ] **Step 3: Replace placeholder taxonomy entries.** Change `FeatureKind` to the seven canonical strings and make `featureKindRegistry` exhaustive. Use `clmm_state` for the three range features, `price_quality` for divergence/confidence/volatility, and `clmm_economics` for the volume ratio; all remain deterministic and active. Allow only clmm-v2, Pyth+Jupiter, Pyth, or Orca sources as required by each formula.

- [ ] **Step 4: Run task-scoped tests and static checks.** Expected: all three test files pass, and lint/format report no issues.

**Validation commands:**

```bash
pnpm exec vitest run tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
pnpm exec eslint src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
```

**Commit:** `feat: define deterministic feature result contract`

## Repository Targets

### Expected Files

- src/contracts/derived-feature.ts
- src/contracts/taxonomy.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- src/domain/taxonomy/validation.ts
- tests/domain/derived-feature/contract.test.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/validation.test.ts
- tests/ports/feature-repo.test.ts
- tests/db/schema/derived-features.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
pnpm exec eslint src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/derived-feature.ts src/contracts/index.ts src/contracts/taxonomy.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/derived-feature/contract.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts tests/ports/feature-repo.test.ts tests/db/schema/derived-features.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **status value coherence**: AVAILABLE and PARTIAL require a finite safe-integer value while UNAVAILABLE requires null. (Test: `accepts an AVAILABLE feature only with a finite safe-integer value`)
- **canonical unit**: Each feature kind accepts only its specified BPS or PPM unit. (Test: `enforces the canonical unit for every feature kind`)
- **scope identity**: Position, pool, and pair feature kinds require exactly their canonical identity fields. (Test: `enforces feature scope identity by kind`)
- **canonical arrays**: Input IDs, rejected IDs, warnings, and reasons are strictly sorted and unique. (Test: `rejects unsorted duplicate observation ids and reason codes`)
- **status-aware provenance**: Only an unavailable result with a stable reason may have no observation references. (Test: `accepts unavailable no-input provenance only with a stable reason`)
- **exact canonical kind set**: Legacy placeholder feature kinds are rejected after the seven-kind registry replaces them. (Test: `rejects removed placeholder feature kinds`)
