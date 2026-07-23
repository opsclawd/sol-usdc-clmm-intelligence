# Task Context: Task 7

Title: Extend lineage verification for contextual event rows

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

- Modify: `src/domain/evidence-bundle/lineage.ts`
- Create: `tests/domain/evidence-bundle/context-events-lineage.test.ts`

- [ ] **Step 1: Write contextual lineage tests**

Write the exact named case `bundle event lineage resolves to retained raw source`. Add failures for missing raw parent, source mismatch, payload-hash mismatch, and an unsupported contextual kind. Verify `macro-calendar-api` and `solana-status-api` map to source type `api`, and source locators use retained raw observation keys.

- [ ] **Step 2: Confirm lineage tests fail**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-lineage.test.ts`

Expected: FAIL because `VerifyEvidenceLineageInput` cannot accept contextual rows.

- [ ] **Step 3: Implement contextual lineage verification**

Modify `VerifyEvidenceLineageInput` to accept `contextualObservations: readonly NormalizedObservationRow[]`. Reuse `verifyProvenanceRef` for every selected contextual row, require its direct raw parent, include normalized/raw IDs and source references in the verified lineage, and reject any contextual row outside `scheduled_event | protocol_incident`. Preserve all existing deterministic-feature and CLMM scope verification.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/evidence-bundle/context-events-lineage.test.ts`

Run: `pnpm exec eslint src/domain/evidence-bundle/lineage.ts tests/domain/evidence-bundle/context-events-lineage.test.ts`

Expected: all selected tests and lint checks pass.

Commit: `git add src/domain/evidence-bundle/lineage.ts tests/domain/evidence-bundle/context-events-lineage.test.ts && git commit -m "feat: verify contextual event lineage"`

## Repository Targets

### Expected Files

- src/domain/evidence-bundle/lineage.ts
- tests/domain/evidence-bundle/context-events-lineage.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/evidence-bundle/context-events-lineage.test.ts
pnpm exec eslint src/domain/evidence-bundle/lineage.ts tests/domain/evidence-bundle/context-events-lineage.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **contextual raw parent**: Every emitted contextual row resolves to a retained raw parent with matching source and hash. (Test: `bundle event lineage resolves to retained raw source`)
- **contextual kind allowlist**: Only scheduled_event and protocol_incident normalized rows enter contextual event lineage. (Test: `rejects unsupported contextual observation kinds`)
