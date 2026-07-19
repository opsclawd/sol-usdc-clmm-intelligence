# Task Context: Task 6

Title: Preserve durable side-effect failures and map every leaf outcome

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-24
Start Commit: f7a18d04ef7d634a88ba3e8a3a6eec1ad65ab581

## Task Requirements

**Files:**

- Modify: `src/application/ingest-raw-observation.ts`
- Modify: `src/application/price-source-result.ts`
- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `src/application/collect-jupiter-quote.ts`
- Create: `src/application/source-outcome.ts`
- Modify: `tests/application/ingest-raw-observation.test.ts`
- Modify: `tests/application/collect-clmm-bundle.test.ts`
- Modify: `tests/application/collect-jupiter-quote.test.ts`
- Create: `tests/application/source-outcome.test.ts`

**Exported API changes:** Add `PostPersistenceOutputError`, extend the `failed` member of `PriceSourceResult` with optional durable evidence metadata, and export `redactDiagnostic`, `mapPriceSourceOutcome`, `mapClmmSourceOutcome`, and `mapSourceError`.

- [ ] **Step 1: Write side-effect recovery tests first.** Add `preserves durable evidence metadata when compatibility output fails` to the shared ingestion tests, asserting raw ID, raw outcome, normalized count, and parsed status on the typed error. Extend the existing CLMM/Jupiter compatibility-file failure cases to assert that mapping reports `failed` with `hasUsableEvidence: true`, the durable raw ID/count, and a redacted diagnostic.
- [ ] **Step 2: Write source mapping tests first.** Cover every `PriceSourceResult` status, CLMM accepted/replay result, `ClmmObservationConflictError`, typed post-persistence output error, and unexpected error. Name cases `maps leaf status without inferring usability from status alone` and `redacts secrets before diagnostics cross the aggregate boundary`.
- [ ] **Step 3: Run focused tests and confirm missing typed error/mappers fail.** Run `pnpm exec vitest run tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts`.
- [ ] **Step 4: Preserve post-persistence state in the shared lifecycle.** Wrap only `writeCompatibilityOutput` failures after parsed/replay success in:

```ts
export class PostPersistenceOutputError extends Error {
  readonly rawObservationId: number;
  readonly rawOutcome: "inserted" | "identical_replay";
  readonly normalizedCount: number;
  readonly parseStatus: "parsed";

  constructor(
    message: string,
    state: {
      readonly rawObservationId: number;
      readonly rawOutcome: "inserted" | "identical_replay";
      readonly normalizedCount: number;
      readonly parseStatus: "parsed";
    },
    options: ErrorOptions
  ) {
    super(message, options);
    this.name = "PostPersistenceOutputError";
    this.rawObservationId = state.rawObservationId;
    this.rawOutcome = state.rawOutcome;
    this.normalizedCount = state.normalizedCount;
    this.parseStatus = state.parseStatus;
  }
}
```

Keep its original error as `cause`. Do not wrap validation, normalization, normalized insertion, or parse-status failures because their durability state is different.

- [ ] **Step 5: Implement safe leaf mapping.** Extend only the price `failed` variant without breaking existing producers:

```ts
export type FailedResult = Readonly<{
  status: "failed";
  summary: string;
  durableEvidence?: Readonly<{
    rawObservationId: number;
    normalizedCount: number;
  }>;
  hasUsableEvidence?: boolean;
}>;
```

Move the existing secret redaction to `redactDiagnostic(text: string): string`, retain `PriceSourceResult.safeSummary`, and implement these exact mapper boundaries:

```ts
export function mapPriceSourceOutcome(
  sourceKey: "pyth" | "jupiter",
  source: "pyth-hermes" | "jupiter-quote",
  result: PriceSourceResult
): SourceCollectionOutcome;

export function mapClmmSourceOutcome(result: CollectClmmBundleResult): SourceCollectionOutcome;

export function mapSourceError(
  sourceKey: CoreSourceKey,
  source: Source,
  error: unknown
): SourceCollectionOutcome;
```

Map source-specific warnings to `{ source, code, message }` without flattening provenance. Preserve explicit `hasUsableEvidence`; never derive it solely from `status`. Map compatibility errors as failed-but-durable, conflicts with both hashes redacted/truncated, and unexpected errors as non-usable `failed`.

- [ ] **Step 6: Verify this task.** Run the focused Vitest command from Step 3, `pnpm exec eslint src/application/ingest-raw-observation.ts src/application/price-source-result.ts src/application/collect-clmm-bundle.ts src/application/collect-jupiter-quote.ts src/application/source-outcome.ts tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts --max-warnings 0`, and `pnpm exec prettier --check src/application/ingest-raw-observation.ts src/application/price-source-result.ts src/application/collect-clmm-bundle.ts src/application/collect-jupiter-quote.ts src/application/source-outcome.ts tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts`.
- [ ] **Step 7: Commit.** Run `git add src/application/ingest-raw-observation.ts src/application/price-source-result.ts src/application/collect-clmm-bundle.ts src/application/collect-jupiter-quote.ts src/application/source-outcome.ts tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts && git commit -m "feat: preserve durable collector outcomes"`.

**Task invariants:**

- `durable compatibility failure` — test case `preserves durable evidence metadata when compatibility output fails`.
- `explicit leaf usability` — test case `maps leaf status without inferring usability from status alone`.
- `aggregate diagnostic redaction` — test case `redacts secrets before diagnostics cross the aggregate boundary`.

## Repository Targets

### Expected Files

- src/application/ingest-raw-observation.ts
- src/application/price-source-result.ts
- src/application/collect-clmm-bundle.ts
- src/application/collect-jupiter-quote.ts
- src/application/source-outcome.ts
- tests/application/ingest-raw-observation.test.ts
- tests/application/collect-clmm-bundle.test.ts
- tests/application/collect-jupiter-quote.test.ts
- tests/application/source-outcome.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts
pnpm exec eslint src/application/ingest-raw-observation.ts src/application/price-source-result.ts src/application/collect-clmm-bundle.ts src/application/collect-jupiter-quote.ts src/application/source-outcome.ts tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts --max-warnings 0
pnpm exec prettier --check src/application/ingest-raw-observation.ts src/application/price-source-result.ts src/application/collect-clmm-bundle.ts src/application/collect-jupiter-quote.ts src/application/source-outcome.ts tests/application/ingest-raw-observation.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-quote.test.ts tests/application/source-outcome.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **durable compatibility failure**: A post-persistence compatibility failure carries raw ID, outcome, normalized count, and parsed state without rolling back database evidence. (Test: `preserves durable evidence metadata when compatibility output fails`)
- **explicit leaf usability**: Mapping preserves the leaf's explicit usability flag and does not infer it only from the status label. (Test: `maps leaf status without inferring usability from status alone`)
- **aggregate diagnostic redaction**: Secrets and credential labels are redacted before any diagnostic enters a core outcome. (Test: `redacts secrets before diagnostics cross the aggregate boundary`)
