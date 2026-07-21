# Task Context: Task 3

Title: Add deterministic bounded retry transitions and make retry required

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-13
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-13
Start Commit: 6abbf0c97574a6b795be47dfb1e295226f6085bf

## Task Requirements

**Files:**

- Modify: `src/application/publish-evidence-bundle.ts`
- Modify: `tests/application/publish-evidence-bundle.test.ts` (only add retry/audit/concurrency describe blocks)
- Modify: `src/adapters/node/composition-root.ts` (only if needed for retry wiring changes)

**Signature changes:** Change `retry` in `PublishEvidenceBundleDeps` from optional to required; extend the existing exported publisher result/event unions with retry exhaustion and scheduling variants. The `RetryControl` port, `SystemRetryControl`, and `FakeRetry` are already introduced in Task 1.

- [ ] Write failing tests named `transient failures retry at most three total attempts`, `unknown outcome retries reuse exact key hash and payload`, `retry delay is bounded and deterministic`, `valid Retry-After is honored within maximum`, `invalid or excessive Retry-After falls back or clamps`, `audit occurs before every retry delay`, `audit failure stops publication before another request`, `exhausted transient failure is terminal and observable`, and `concurrent duplicate audit conflict is not reported as success`.
- [ ] Replace the single HTTP action with attempts 1..3. Retry only `HttpRequestError` timeout/network, 408, 429, and 500..599. After each failed request, persist `network_failed`; only after successful audit emit `retry_scheduled`, sleep, and transition to the next attempt. On attempt 3 return `transient_failure_exhausted`.
- [ ] Use base delay 250 ms, exponential factors 1 and 2, jitter up to 250 ms, and a hard 2,000 ms sleep cap. Parse `Retry-After` as non-negative delta-seconds or an HTTP date relative to `Clock`; clamp it to 2,000 ms. Invalid/missing values use exponential+jitter.
- [ ] Keep one immutable request context outside the loop (payload reference, verified hash, idempotency key, endpoint, safe target), and create timestamps/attempt rows inside the loop. Emit `publish_started`, `retry_scheduled`, `created`, `idempotent_replay`, classified terminal failure, `transient_failure_exhausted`, and `audit_persistence_failed` events.
- [ ] Run only the newly added behavior groups:

  ```bash
  pnpm vitest run tests/application/publish-evidence-bundle.test.ts -t 'retry|Retry-After|audit failure|exhausted|concurrent'
  pnpm exec eslint src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts --max-warnings 0
  ```

- [ ] Commit: `git add src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts && git commit -m "feat: bound evidence publish retries"`

## Repository Targets

### Expected Files

- src/application/publish-evidence-bundle.ts
- tests/application/publish-evidence-bundle.test.ts

## Validation Commands

```bash
pnpm vitest run tests/application/publish-evidence-bundle.test.ts -t 'retry|Retry-After|audit failure|exhausted|concurrent'
pnpm exec eslint src/application/publish-evidence-bundle.ts tests/application/publish-evidence-bundle.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **transient-failures-retry-at-most-three-total-attempts**: Timeout, network, 408, 429, and 5xx failures transition through at most three audited attempts. (Test: `transient failures retry at most three total attempts`)
- **unknown-outcome-reuses-identity**: Every retry reuses the exact payload reference, payload hash, and idempotency key established before the loop. (Test: `unknown outcome retries reuse exact key hash and payload`)
- **retry-delay-is-bounded**: Exponential jitter and Retry-After delays are deterministic under fakes and never exceed 2000 ms. (Test: `retry delay is bounded and deterministic`)
- **audit-before-retry-transition**: A transient result is inserted before retry_scheduled is emitted or sleep begins. (Test: `audit occurs before every retry delay`)
- **audit-failure-stops-publication**: An insert exception or audit identity conflict returns audit_store_failed and prevents a later request. (Test: `audit failure stops publication before another request`)
- **concurrent-duplicate-is-not-silent**: An audit identity collision is observable and the losing invocation cannot report remote success. (Test: `concurrent duplicate audit conflict is not reported as success`)
