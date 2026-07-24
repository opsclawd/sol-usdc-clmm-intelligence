# Task Context: Task 8

Title: Populate evidence bundles with selected contextual events

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

- Modify: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/application/assemble-evidence-bundle.ts`
- Create: `tests/domain/evidence-bundle/context-events-assemble.test.ts`
- Create: `tests/application/assemble-context-events.test.ts`

- [ ] **Step 1: Write bundle mapping and orchestration tests**

Write the exact named case `bundle event direction is always unknown`. Test scheduled and protocol mappings, severity/status appearing only as factual claim text, confidence conversion to bounded basis points, canonical timestamps, expiry, source reference IDs, a 64-event cap, no stale/cancelled events, resolved recovery evidence, and empty events when feeds are unavailable.

At the application boundary, assert `normalizedRepo.listCandidates` requests exactly:

```ts
{
  sourceKinds: [
    { source: "macro-calendar-api", observationKind: "scheduled_event" },
    { source: "solana-status-api", observationKind: "protocol_incident" }
  ],
  receivedAtOrAfterUnixMs: evaluationTimeUnixMs - 7 * 24 * 60 * 60 * 1000
}
```

Also prove contextual raw/normalized rows are loaded into lineage before contract validation and that contextual-query failure degrades to an empty event list plus an assembly warning instead of fabricating evidence.

- [ ] **Step 2: Confirm bundle tests fail**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Expected: FAIL because bundle assembly always emits an empty event list.

- [ ] **Step 3: Implement contextual bundle assembly**

Change `AssembleEvidenceBundleInput` to include `contextualEvents: readonly SelectedContextEvent[]`. Map each selected row to the existing generated `EventClaim`:

```ts
{
  evidenceId: `normalized-${row.id}`,
  kind: payload.kind,
  claim: `${payload.status}: ${payload.title} — ${payload.description}`,
  direction: "unknown",
  confidenceBps: Math.round(row.confidence.compositeScore * 10_000),
  observedAt: String(payload.asOfUnixMs),
  expiresAt: String(payload.expiresAtUnixMs),
  sourceReferenceIds: [`raw-${row.rawObservationId}`],
  provenanceMethod: "collected"
}
```

In `assembleEvidenceBundle`, query contextual candidates, call `selectCurrentContextEvents`, add their normalized/raw IDs to lineage loading, pass them to `verifyEvidenceLineage`, set `contextPresent` from the selected count, and pass them to domain assembly. Keep deterministic-feature availability as the gate for whether a bundle is emitted; contextual evidence supplements but never independently authorizes a bundle.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Run: `pnpm exec eslint src/domain/evidence-bundle/assemble.ts src/application/assemble-evidence-bundle.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/evidence-bundle/assemble.ts src/application/assemble-evidence-bundle.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts && git commit -m "feat: include current events in evidence bundles"`

## Repository Targets

### Expected Files

- src/domain/evidence-bundle/assemble.ts
- src/application/assemble-evidence-bundle.ts
- tests/domain/evidence-bundle/context-events-assemble.test.ts
- tests/application/assemble-context-events.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts
pnpm exec eslint src/domain/evidence-bundle/assemble.ts src/application/assemble-evidence-bundle.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/application/assemble-context-events.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **unknown direction**: Every scheduled event and incident maps to EventClaim direction unknown. (Test: `bundle event direction is always unknown`)
- **context supplement only**: Contextual events never bypass the deterministic-feature gate for emitting a bundle. (Test: `does not emit a bundle from contextual events alone`)
- **query degradation**: A contextual candidate-query failure emits no event claims and records a warning without fabricating evidence. (Test: `degrades contextual query failure to an empty event list`)
