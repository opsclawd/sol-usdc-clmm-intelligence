# Task Context: Task 2

Title: Implement bounded validation, identity, normalization, and enrichment

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

- Create: `src/domain/context-events/validate.ts`
- Create: `src/domain/context-events/identity.ts`
- Create: `src/domain/context-events/normalize.ts`
- Create: `src/domain/context-events/enrich.ts`
- Create: `src/domain/context-events/index.ts`
- Create: `tests/fixtures/context-events.ts`
- Create: `tests/domain/context-events/validate.test.ts`
- Create: `tests/domain/context-events/identity.test.ts`
- Create: `tests/domain/context-events/normalize.test.ts`
- Create: `tests/domain/context-events/enrich.test.ts`

- [ ] **Step 1: Write invariant-first domain tests**

Write the exact named cases:

- `normalizes a first scheduled state as SCHEDULED`
- `appends a postponed scheduled state without changing sourceEventId`
- `unconfirmed incident cannot become active without qualifying confirmation`
- `qualified incident activation preserves history`
- `incident resolution replaces active state until recovery expiry`

Also test bounded strings/arrays, strict projection, source and retrieval timestamps remaining separate, deterministic output ordering, severity threshold boundaries, token unlock and upgrade examples, time conflicts, explicit source disagreement, incomplete data, expiry defaults, confidence caps for unconfirmed/partial evidence, stale warnings, and provenance validation.

- [ ] **Step 2: Confirm domain tests fail**

Run: `pnpm exec vitest run tests/domain/context-events/validate.test.ts tests/domain/context-events/identity.test.ts tests/domain/context-events/normalize.test.ts tests/domain/context-events/enrich.test.ts`

Expected: FAIL because the context-event domain modules do not exist.

- [ ] **Step 3: Implement pure domain functions**

Provide these stable APIs:

```ts
export function acceptScheduledEventSnapshot(input: unknown): BoundedScheduledEventSnapshot;
export function acceptProtocolIncidentSnapshot(input: unknown): BoundedProtocolIncidentSnapshot;
export function deriveContextSnapshotObservationKey(input: {
  source: "macro-calendar-api" | "solana-status-api";
  providerId: string;
  sourceObservedAtUnixMs: number;
  payloadHash: string;
}): Promise<string>;
export function normalizeScheduledEvents(
  snapshot: BoundedScheduledEventSnapshot,
  retrievedAtUnixMs: number
): readonly ScheduledEventPayloadV1[];
export function normalizeProtocolIncidents(
  snapshot: BoundedProtocolIncidentSnapshot,
  retrievedAtUnixMs: number
): readonly ProtocolIncidentPayloadV1[];
export function enrichContextEvent(input: {
  payload: ScheduledEventPayloadV1 | ProtocolIncidentPayloadV1;
  source: "macro-calendar-api" | "solana-status-api";
  rawId: number;
  nowMs: number;
  codeVersion: string;
  runId: string | null;
}): Promise<EnrichedContextEventObservation>;
```

Use Zod `.strict()` schemas, finite integer timestamp validation, bounded descriptions and reference arrays, sorted/deduplicated string arrays, the deterministic severity/confirmation/expiry rules above, `computeFreshness`, `computeConfidence`, `validateProvenance`, and canonical payload hashing. Do not inspect headlines for direction.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/context-events/validate.test.ts tests/domain/context-events/identity.test.ts tests/domain/context-events/normalize.test.ts tests/domain/context-events/enrich.test.ts`

Run: `pnpm exec eslint src/domain/context-events tests/domain/context-events tests/fixtures/context-events.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/context-events tests/domain/context-events tests/fixtures/context-events.ts && git commit -m "feat: normalize contextual event evidence"`

## Repository Targets

### Expected Files

- src/domain/context-events/validate.ts
- src/domain/context-events/identity.ts
- src/domain/context-events/normalize.ts
- src/domain/context-events/enrich.ts
- src/domain/context-events/index.ts
- tests/fixtures/context-events.ts
- tests/domain/context-events/validate.test.ts
- tests/domain/context-events/identity.test.ts
- tests/domain/context-events/normalize.test.ts
- tests/domain/context-events/enrich.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/context-events/validate.test.ts tests/domain/context-events/identity.test.ts tests/domain/context-events/normalize.test.ts tests/domain/context-events/enrich.test.ts
pnpm exec eslint src/domain/context-events tests/domain/context-events tests/fixtures/context-events.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **initial scheduled state**: A valid first scheduled source record normalizes to one SCHEDULED payload with bounded expiry. (Test: `normalizes a first scheduled state as SCHEDULED`)
- **postponement history linkage**: A changed scheduled time preserves sourceEventId while producing a distinct postponed state. (Test: `appends a postponed scheduled state without changing sourceEventId`)
- **confirmation guard**: Provider ACTIVE without official or primary confirmation remains UNCONFIRMED. (Test: `unconfirmed incident cannot become active without qualifying confirmation`)
- **qualified activation**: Official or primary confirmation permits an UNCONFIRMED incident to produce a later ACTIVE state without mutation. (Test: `qualified incident activation preserves history`)
- **resolution recovery window**: A resolved incident receives a deterministic short recovery expiry derived from resolvedAtUnixMs. (Test: `incident resolution replaces active state until recovery expiry`)
