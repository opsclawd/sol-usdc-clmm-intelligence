# Task Context: Task 4

Title: Normalize, identify, and enrich perp observations

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-11
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-11
Start Commit: d62ccad6f3f1f0812dc1d59b322256f63fbcf7ba

## Task Requirements

**Files:**

- Create: `src/domain/perp-liquidation/validate.ts`
- Create: `src/domain/perp-liquidation/normalize.ts`
- Create: `src/domain/perp-liquidation/identity.ts`
- Create: `src/domain/perp-liquidation/enrich.ts`
- Create: `src/domain/perp-liquidation/index.ts`
- Create: `tests/domain/perp-liquidation/validate.test.ts`
- Create: `tests/domain/perp-liquidation/normalize.test.ts`
- Create: `tests/domain/perp-liquidation/identity.test.ts`
- Create: `tests/domain/perp-liquidation/enrich.test.ts`

- [ ] **Step 1: Write failing pure-domain tests**

  Cover signed funding, positive OI/prices/notional, basis with both positive and negative spread, liquidation side, sorted source identity, stale confidence degradation, provenance validation, and rejection of venue-only fields. Include exact cases:
  - `preserves positive and negative funding rates through normalization`;
  - `transitions a persisted fresh fact to degraded evidence when freshness policy marks the input stale`;
  - `derives the same identity for reordered object keys`;
  - `uses venue kind instrument observed time and provider event id as identity`.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm vitest run tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement validation and normalization**

  Validation accepts only the port union, finite integer timestamps, canonical decimal strings, expected pair, and metric-specific required fields. Normalization maps each source fact to `PerpObservationPayloadV1`, recomputes basis from canonical mark/spot decimals rather than trusting a provider spread, and sorts/deduplicates references.

- [ ] **Step 4: Implement deterministic identities**

  Hash canonical tuples:

  ```ts
  {
    (source, kind, instrument, observedAtUnixMs, sourceEventId);
  }
  ```

  For windowed aggregate facts, `sourceEventId` must itself be based on provider window bounds. Never include a run ID in observation identity.

- [ ] **Step 5: Implement enrichment**

  Use taxonomy registry policies and existing `computeFreshness`, `computeConfidence`, `canonicalizePayload`, and `validateProvenance`. Direct observations carry one raw/source ref. When stale behavior is `degrade_confidence`, append `stale_input_degraded` exactly once and cap the level below `high`; do not rewrite the observed timestamp.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/domain/perp-liquidation/validate.ts src/domain/perp-liquidation/normalize.ts src/domain/perp-liquidation/identity.ts src/domain/perp-liquidation/enrich.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/domain/perp-liquidation tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts
  git commit -m "feat: normalize and enrich perp observations"
  ```

## Repository Targets

### Expected Files

- src/domain/perp-liquidation/validate.ts
- src/domain/perp-liquidation/normalize.ts
- src/domain/perp-liquidation/identity.ts
- src/domain/perp-liquidation/enrich.ts
- src/domain/perp-liquidation/index.ts
- tests/domain/perp-liquidation/validate.test.ts
- tests/domain/perp-liquidation/normalize.test.ts
- tests/domain/perp-liquidation/identity.test.ts
- tests/domain/perp-liquidation/enrich.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts
pnpm exec eslint src/domain/perp-liquidation/validate.ts src/domain/perp-liquidation/normalize.ts src/domain/perp-liquidation/identity.ts src/domain/perp-liquidation/enrich.ts src/domain/perp-liquidation/index.ts tests/domain/perp-liquidation/validate.test.ts tests/domain/perp-liquidation/normalize.test.ts tests/domain/perp-liquidation/identity.test.ts tests/domain/perp-liquidation/enrich.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **signed funding normalization**: Positive and negative decimal funding signs survive validation and normalization unchanged. (Test: `preserves positive and negative funding rates through normalization`)
- **stale confidence transition**: A stale normalized fact is retained but gains stale_input_degraded and cannot remain high confidence. (Test: `transitions a persisted fresh fact to degraded evidence when freshness policy marks the input stale`)
- **stable fact identity**: Identity depends on source, kind, instrument, observed time, and provider event ID, not object key order or run ID. (Test: `uses venue kind instrument observed time and provider event id as identity`)
