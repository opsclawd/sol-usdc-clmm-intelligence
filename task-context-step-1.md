# Task Context: Task 1

Title: Add complete bundle acceptance validation

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Modify: `src/contracts/clmm-bundle.ts`
- Create: `src/domain/clmm-bundle/validate.ts`
- Create: `src/domain/clmm-bundle/index.ts`
- Create: `tests/fixtures/clmm-bundle.ts`
- Create: `tests/domain/clmm-bundle/validate.test.ts`

**Behavioral invariants to test first:**

- `accepts a complete bundle with zero or multiple positions and alerts` proves cardinality is not hard-coded.
- `rejects every non-finite numeric field consumed by identity or normalization` covers pool, position, valuation, decimal, distance, and timestamp fields.
- `rejects mismatched pair source pool and alert references before persistence` covers bundle/pool/position consistency and alert-to-position referential integrity.
- `accepts declared optional values and preserves them for null materialization` covers optional price distances, trigger qualification fields, reward valuations, and nullable decimals.

- [ ] **Step 1: Create one reusable complete fixture and write failing table-driven validator tests.** Export `makeClmmBundle(overrides?)` from `tests/fixtures/clmm-bundle.ts`; include a pool, two positions, fee token A/B data, rewards, one matching alert, and partial data-quality warnings. Tests must clone/mutate one nested field per case so the error names the exact rejected path.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/clmm-bundle/validate.test.ts` and confirm failures because `acceptClmmBundleEnvelope` does not exist.**
- [ ] **Step 3: Implement the full runtime acceptance boundary.** Use Zod or equivalent explicit parsing to export two functions:

```ts
export function acceptClmmBundleEnvelope(response: unknown): ClmmBundle;
export function acceptClmmBundle(bundle: unknown): ClmmBundle;
```

`acceptClmmBundleEnvelope` validates the full HTTP response envelope and returns `response.bundle`. `acceptClmmBundle` validates the unwrapped bundle directly (used for replay validation where `row.payloadCanonical` stores the already-unwrapped `ClmmBundle`). Validate all declared nested containers, literal enums, decimal strings, finite numbers, nullable/optional fields, and cross-record consistency. Unknown extra source fields may remain in raw evidence, but no unvalidated cast may enter normalization.

- [ ] **Step 4: Export both validators (`acceptClmmBundleEnvelope` for HTTP response envelopes and `acceptClmmBundle` for unwrapped bundle replay from `row.payloadCanonical`) through `src/domain/clmm-bundle/index.ts`, then rerun the focused test and expect all cases to pass.**
- [ ] **Step 5: Run `pnpm exec eslint src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts --max-warnings 0` and `pnpm exec prettier --check src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts`.**
- [ ] **Step 6: Commit:** `git add src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts && git commit -m "feat(clmm): validate complete bundle contract"`.

## Repository Targets

### Expected Files

- src/contracts/clmm-bundle.ts
- src/domain/clmm-bundle/validate.ts
- src/domain/clmm-bundle/index.ts
- tests/fixtures/clmm-bundle.ts
- tests/domain/clmm-bundle/validate.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/clmm-bundle/validate.test.ts
pnpm exec eslint src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/clmm-bundle.ts src/domain/clmm-bundle/validate.ts src/domain/clmm-bundle/index.ts tests/fixtures/clmm-bundle.ts tests/domain/clmm-bundle/validate.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **complete bundle cardinality**: A complete accepted bundle may contain zero or multiple positions and alerts without single-position assumptions. (Test: `accepts a complete bundle with zero or multiple positions and alerts`)
- **finite normalized inputs**: Every numeric value consumed by identity or normalization must be finite. (Test: `rejects every non-finite numeric field consumed by identity or normalization`)
- **cross-record consistency**: Pair, source, pool, position, and alert references must agree before the response is accepted. (Test: `rejects mismatched pair source pool and alert references before persistence`)
- **optional value acceptance**: Declared optional and nullable values remain accepted so normalization can materialize absence as null. (Test: `accepts declared optional values and preserves them for null materialization`)
