# Task Context: Task 4

Title: Implement raw-first event collection and append-only lifecycle persistence

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

- Create: `src/application/collect-context-events.ts`
- Create: `src/application/collect-scheduled-events.ts`
- Create: `src/application/collect-protocol-incidents.ts`
- Create: `tests/application/collect-context-events.test.ts`

- [ ] **Step 1: Write persistence and lifecycle tests first**

Write the exact named cases:

- `exact source snapshot replay writes no duplicate normalized rows`
- `changed snapshot appends raw and normalized history`
- `unavailable source creates no absence claim`

Also prove that accepted bounded source data is inserted into `raw_observations` before normalized inserts, each normalized row points to its raw parent, multiple events from one snapshot insert atomically through `insertMany`, malformed snapshots write nothing, partial-invalid records retain the accepted bounded snapshot and return warnings without fabricating normalized data, and source timestamps differ from retrieval timestamps.

- [ ] **Step 2: Confirm application tests fail**

Run: `pnpm exec vitest run tests/application/collect-context-events.test.ts`

Expected: FAIL because the collection use cases do not exist.

- [ ] **Step 3: Implement the collection use cases**

Use a private generic orchestration helper plus explicit wrappers:

```ts
export async function collectScheduledEvents(
  deps: CollectScheduledEventsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult>;
export async function collectProtocolIncidents(
  deps: CollectProtocolIncidentsDeps,
  context: CollectionRunContext
): Promise<ContextEventCollectionResult>;
```

The helper must canonicalize the bounded snapshot, derive its version-specific raw key, call `ingestRawObservation`, build/enrich all normalized candidates, and call `normalizedObservationRepo.insertMany`. Return `accepted`, `degraded`, `stale`, `identical_replay`, `malformed`, `timeout`, `network`, `unavailable`, or `failed` with counts and redacted diagnostics. A changed provider snapshot gets a changed version key and appends history; stable event linkage remains the normalized `sourceEventId`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/application/collect-context-events.test.ts`

Run: `pnpm exec eslint src/application/collect-context-events.ts src/application/collect-scheduled-events.ts src/application/collect-protocol-incidents.ts tests/application/collect-context-events.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/application/collect-context-events.ts src/application/collect-scheduled-events.ts src/application/collect-protocol-incidents.ts tests/application/collect-context-events.test.ts && git commit -m "feat: persist contextual event lifecycle history"`

## Repository Targets

### Expected Files

- src/application/collect-context-events.ts
- src/application/collect-scheduled-events.ts
- src/application/collect-protocol-incidents.ts
- tests/application/collect-context-events.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/collect-context-events.test.ts
pnpm exec eslint src/application/collect-context-events.ts src/application/collect-scheduled-events.ts src/application/collect-protocol-incidents.ts tests/application/collect-context-events.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact replay idempotency**: An identical bounded snapshot reuses its raw row and inserts no normalized duplicates. (Test: `exact source snapshot replay writes no duplicate normalized rows`)
- **append-only change**: A changed snapshot receives a distinct raw key and appends normalized lifecycle states. (Test: `changed snapshot appends raw and normalized history`)
- **raw-first ordering**: Accepted bounded source data is persisted before any normalized insert. (Test: `persists bounded raw evidence before normalized candidates`)
- **no absence claim**: Unavailable sources create no raw or normalized observation claiming no events. (Test: `unavailable source creates no absence claim`)
