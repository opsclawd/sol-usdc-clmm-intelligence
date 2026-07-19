# Fix Task 6 Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map all leaf collection outcomes using standardized mapping functions and preserve durable side-effect failure information across price observations, Orca, and CLMM.

**Architecture:** Use pure mapping functions defined in `source-outcome.ts` at job/application boundaries. Catch `PostPersistenceOutputError` specifically to map to durable failure outcomes.

**Tech Stack:** TypeScript, Vitest

---

## Tasks

### Task 1: Update Pyth and Jupiter Price Collectors to Catch PostPersistenceOutputError

**Files:**

- Modify: [collect-pyth-price.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/src/application/collect-pyth-price.ts)
- Modify: [collect-jupiter-quote.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/src/application/collect-jupiter-quote.ts)

- [ ] **Step 1: Update collectPythPrice catch block**
      Check if `err instanceof Error && err.name === "PostPersistenceOutputError"`. Return a `FailedResult` with `durableEvidence` (`rawObservationId`, `normalizedCount`) and `hasUsableEvidence: true`.
- [ ] **Step 2: Update collectJupiterQuote catch block**
      Check if `err instanceof Error && err.name === "PostPersistenceOutputError"`. Return a `FailedResult` with `durableEvidence` (`rawObservationId`, `normalizedCount`) and `hasUsableEvidence: true`.

---

### Task 2: Standardize Outcomes in Price Observations Entrypoint

**Files:**

- Modify: [collect-price-observations.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/src/application/collect-price-observations.ts)

- [ ] **Step 1: Catch PostPersistenceOutputError in collectPriceObservations promise catch handlers**
      Ensure the catch handlers for `collectPythPrice` and `collectJupiterQuote` calls check for `PostPersistenceOutputError` and map to `FailedResult` with `durableEvidence`.
- [ ] **Step 2: Map results using mapPriceSourceOutcome**
      Map `pythResult` and `jupiterResult` to `SourceCollectionOutcome` using `mapPriceSourceOutcome`. Update the return interface `CollectPriceObservationsResult` to define `pyth` and `jupiter` as `SourceCollectionOutcome`.

---

### Task 3: Handle PostPersistenceOutputError in Orca Pool Statistics Catch Block

**Files:**

- Modify: [collect-orca-pool-statistics.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/src/application/collect-orca-pool-statistics.ts)

- [ ] **Step 1: Check for PostPersistenceOutputError using mapSourceError**
      In the `catch` block of `collectOrcaPoolStatistics`, check if `err` is a `PostPersistenceOutputError` and return `mapSourceError(SOURCE_KEY, SOURCE, err)`.

---

### Task 4: Standardize CLMM Job Outcomes and Update Script/Tests

**Files:**

- Modify: [clmm-bundle-job.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/src/jobs/clmm-bundle-job.ts)
- Modify: [clmm-bundle.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/scripts/collectors/clmm-bundle.ts)
- Modify: [clmm-bundle.test.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-24/tests/scripts/clmm-bundle.test.ts)

- [ ] **Step 1: Update clmmBundleJob to catch errors and return SourceCollectionOutcome**
      Catch errors in `clmmBundleJob` and map them using `mapSourceError`. Map successful result via `mapClmmSourceOutcome`.
- [ ] **Step 2: Update runClmmBundleCollector in clmm-bundle.ts**
      Support the new `SourceCollectionOutcome` return type, and throw an error on failed or conflict outcomes to maintain existing CLI error-out behaviors.
- [ ] **Step 3: Update clmmBundleJob result type tests**
      Change tests in `clmm-bundle.test.ts` to assert on `SourceCollectionOutcome` fields instead of `CollectClmmBundleResult`.

---

### Task 5: Verification

- [ ] **Step 1: Run vitest**
      Ensure all tests compile and pass.
- [ ] **Step 2: Run boundaries**
      Validate package architecture boundaries via `pnpm verify`.
