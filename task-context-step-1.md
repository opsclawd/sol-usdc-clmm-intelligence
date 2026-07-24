# Task Context: Task 1

Title: Add contextual event contracts and taxonomy entries

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

- Create: `src/contracts/context-events.ts`
- Create: `tests/contracts/context-events.test.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts`

- [ ] **Step 1: Write failing contract and registry tests**

Cover strict scheduled/incident payload shapes, lifecycle enums, warnings, severity, source quality, raw provenance, required temporal fields, and rejection of unknown fields. Add registry assertions that both kinds use `macro_protocol_risk`, `contextual`, `exclude`, schema version 1, and only their matching source.

Use these exported shapes:

```ts
export type ContextEventStatus = "SCHEDULED" | "ACTIVE" | "RESOLVED" | "CANCELLED" | "UNCONFIRMED";
export type ContextEventSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type ContextEventWarning =
  | "conflicting_times"
  | "source_disagreement"
  | "incomplete_information"
  | "missing_qualifying_confirmation"
  | "postponed"
  | "stale_observation";
export type ContextEventSourceQuality = {
  readonly providerId: string;
  readonly reliability: number;
  readonly completeness: "complete" | "partial";
  readonly confirmation: "official" | "primary" | "secondary" | "none";
};
export type ContextEventRawProvenance = {
  readonly sourceObservedAtUnixMs: number;
  readonly retrievedAtUnixMs: number;
  readonly retentionMode: "bounded_factual_extract";
  readonly license: string;
};
```

Define `ScheduledEventPayloadV1` and `ProtocolIncidentPayloadV1` as strict discriminated schemas/types. Both include `sourceEventId`, `eventFamily`, `eventType`, `title`, `description`, `asOfUnixMs`, `expiresAtUnixMs`, `severity`, `status`, `affectedScope`, `sourceReferences`, `sourceQuality`, `rawProvenance`, and `warnings`; scheduled events require `scheduledStartUnixMs` and nullable `scheduledEndUnixMs`, while incidents require `detectedAtUnixMs` and nullable `resolvedAtUnixMs`.

- [ ] **Step 2: Confirm the new tests fail**

Run: `pnpm exec vitest run tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Expected: FAIL because the contracts, kinds, sources, and registry entries do not exist.

- [ ] **Step 3: Implement contracts and taxonomy**

Add `"scheduled_event" | "protocol_incident"` to `ObservationKind` and `"macro-calendar-api" | "solana-status-api"` to `Source`. Export the new contracts from `src/contracts/index.ts`. Add registry entries with contextual confidence weights, source allowlists, and freshness policies of 24 hours for scheduled feed refreshes and 15 minutes for incident feed refreshes; both use source-provided expiry as the tighter bound and `staleBehavior: "exclude"`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Run: `pnpm exec eslint src/contracts/context-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/contracts/context-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts && git commit -m "feat: define contextual event evidence contracts"`

## Repository Targets

### Expected Files

- src/contracts/context-events.ts
- src/contracts/taxonomy.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- tests/contracts/context-events.test.ts
- tests/domain/taxonomy/registry.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts
pnpm exec eslint src/contracts/context-events.ts src/contracts/taxonomy.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/context-events.test.ts tests/domain/taxonomy/registry.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **scheduled temporal shape**: A scheduled event requires scheduledStartUnixMs and permits only a nullable scheduledEndUnixMs. (Test: `requires scheduled timestamps for scheduled event payloads`)
- **incident temporal shape**: A protocol incident requires detectedAtUnixMs and permits only a nullable resolvedAtUnixMs. (Test: `requires detected timestamps for protocol incident payloads`)
