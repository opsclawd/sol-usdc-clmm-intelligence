# Task Context: Task 3

Title: Add source ports and bounded HTTP adapters

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-28
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-28
Start Commit: ed7e5c030c3f6ef4e1383e3236e36cf521bdb9a2

## Task Requirements

**Files:**

- Create: `src/ports/scheduled-event-source.ts`
- Create: `src/ports/protocol-incident-source.ts`
- Create: `src/adapters/node/http-scheduled-event-source.ts`
- Create: `src/adapters/node/http-protocol-incident-source.ts`
- Create: `tests/fakes/fake-scheduled-event-source.ts`
- Create: `tests/fakes/fake-protocol-incident-source.ts`
- Create: `tests/adapters/node/http-scheduled-event-source.test.ts`
- Create: `tests/adapters/node/http-protocol-incident-source.test.ts`
- Modify: `src/ports/index.ts`
- Modify: `tests/fakes/index.ts`

- [ ] **Step 1: Write adapter contract tests**

Test a bounded look-ahead request for scheduled events and a Solana-mainnet request for incidents; optional bearer auth; unknown-field removal; retention/license enforcement; timeout, network, malformed, 404/429/5xx classification; secret redaction; and bounded retry timing.

Define complete port/implementation pairs in this task:

```ts
export interface ScheduledEventSourcePort {
  collect(request: {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }): Promise<ScheduledEventSourceSnapshot>;
}
export interface ProtocolIncidentSourcePort {
  collect(request: { readonly network: "solana-mainnet" }): Promise<ProtocolIncidentSourceSnapshot>;
}
```

Each snapshot exposes provider/source timestamps, reliability, license/retention metadata, bounded records, factual source references, and explicit confirmation level. Use the shared source error union `timeout | network | unavailable | malformed`.

- [ ] **Step 2: Confirm adapter tests fail**

Run: `pnpm exec vitest run tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Expected: FAIL because the ports and adapters do not exist.

- [ ] **Step 3: Implement both ports and all implementations**

Implement both adapters with the existing `HttpClient` and `RetryControl`. Use at most two attempts, one adapter-level request per attempt, exponential backoff capped at 400 ms plus injected jitter, and no retries for malformed responses or non-retryable 4xx responses. Project accepted responses into frozen bounded snapshots and redact the configured credential from diagnostics.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Run: `pnpm exec eslint src/ports/scheduled-event-source.ts src/ports/protocol-incident-source.ts src/ports/index.ts src/adapters/node/http-scheduled-event-source.ts src/adapters/node/http-protocol-incident-source.ts tests/fakes/fake-scheduled-event-source.ts tests/fakes/fake-protocol-incident-source.ts tests/fakes/index.ts tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/ports src/adapters/node/http-scheduled-event-source.ts src/adapters/node/http-protocol-incident-source.ts tests/fakes tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts && git commit -m "feat: add contextual event source adapters"`

## Repository Targets

### Expected Files

- src/ports/scheduled-event-source.ts
- src/ports/protocol-incident-source.ts
- src/ports/index.ts
- src/adapters/node/http-scheduled-event-source.ts
- src/adapters/node/http-protocol-incident-source.ts
- tests/fakes/fake-scheduled-event-source.ts
- tests/fakes/fake-protocol-incident-source.ts
- tests/fakes/index.ts
- tests/adapters/node/http-scheduled-event-source.test.ts
- tests/adapters/node/http-protocol-incident-source.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts
pnpm exec eslint src/ports/scheduled-event-source.ts src/ports/protocol-incident-source.ts src/ports/index.ts src/adapters/node/http-scheduled-event-source.ts src/adapters/node/http-protocol-incident-source.ts tests/fakes/fake-scheduled-event-source.ts tests/fakes/fake-protocol-incident-source.ts tests/fakes/index.ts tests/adapters/node/http-scheduled-event-source.test.ts tests/adapters/node/http-protocol-incident-source.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded retry**: Retryable failures perform at most two adapter attempts, with each HttpClient call configured for one attempt. (Test: `retries a retryable source failure once without nested HTTP retries`)
- **nonretryable failure**: Malformed and non-retryable 4xx responses stop immediately. (Test: `does not retry malformed or non-retryable responses`)
- **bounded retention**: Only responses declaring bounded factual extraction and a non-empty license are accepted. (Test: `rejects source snapshots without bounded retention permission`)
