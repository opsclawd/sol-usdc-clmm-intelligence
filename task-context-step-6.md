# Task Context: Task 6

Title: Select only the latest eligible lifecycle state

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

- Create: `src/domain/context-events/select.ts`
- Create: `tests/domain/context-events/select.test.ts`
- Modify: `src/domain/context-events/index.ts`

- [ ] **Step 1: Write selection invariants first**

Write the exact named cases:

- `cancellation becomes the latest state and suppresses older scheduled evidence`
- `incident resolution replaces active state until recovery expiry`
- `latest ineligible state never revives older active state`

Also cover deterministic grouping by source/kind/sourceEventId, tie-breaking by `asOfUnixMs`, then `receivedAtUnixMs`, then row ID; strict provider isolation; future observations; stale flags; expiry at the exact evaluation boundary; resolved recovery evidence; a maximum of 64 selected events; and stable output ordering.

- [ ] **Step 2: Confirm selection tests fail**

Run: `pnpm exec vitest run tests/domain/context-events/select.test.ts`

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement selection**

Export:

```ts
export interface ContextEventSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly candidates: readonly NormalizedObservationRow[];
  readonly maxItems: number;
}
export interface SelectedContextEvent {
  readonly row: NormalizedObservationRow;
  readonly payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
}
export function selectCurrentContextEvents(
  request: ContextEventSelectionRequest
): readonly SelectedContextEvent[];
```

Validate payload discriminants before grouping. Determine the latest row for every identity first, then apply eligibility; this ordering enforces the no-revival invariant. Sort selected rows by severity rank, event time, source, source event ID, and row ID before applying `maxItems`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/context-events/select.test.ts`

Run: `pnpm exec eslint src/domain/context-events/select.ts src/domain/context-events/index.ts tests/domain/context-events/select.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/context-events/select.ts src/domain/context-events/index.ts tests/domain/context-events/select.test.ts && git commit -m "feat: select current contextual event states"`

## Repository Targets

### Expected Files

- src/domain/context-events/select.ts
- src/domain/context-events/index.ts
- tests/domain/context-events/select.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/context-events/select.test.ts
pnpm exec eslint src/domain/context-events/select.ts src/domain/context-events/index.ts tests/domain/context-events/select.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **cancelled latest state**: A latest CANCELLED state suppresses every older SCHEDULED state for the same identity. (Test: `cancellation becomes the latest state and suppresses older scheduled evidence`)
- **resolved recovery state**: A latest RESOLVED state is selected only until its recovery expiry. (Test: `incident resolution replaces active state until recovery expiry`)
- **no revival**: Eligibility is applied after latest-state grouping, so an ineligible latest row never revives an older active row. (Test: `latest ineligible state never revives older active state`)
