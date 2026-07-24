# Task Context: Task 3

Title: Cluster duplicates corroboration conflicts and corrections

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-29
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-29
Start Commit: c4ebafe2e56545826828c5cef80a53840e1a3cda

## Task Requirements

**Files:**

- Create: `src/domain/news-events/cluster.ts`
- Create: `tests/domain/news-events/cluster.test.ts`
- Modify: `src/domain/news-events/index.ts`

- [ ] **Step 1: Write clustering state-transition tests first**

Write the exact named cases:

- `provider syndication id groups copies without corroboration`
- `near duplicate clustering is deterministic across input order`
- `independent publishers with distinct originating reports corroborate`
- `conflicting reports remain visible as conflicting evidence`
- `correction appends a linked version without overwriting history`

Add threshold boundary tests at `0.79` and `0.80`, 72-hour boundary tests, affected-scope mismatch tests, a case proving same-publisher rewrites do not corroborate, and a case proving corrections inherit the corrected record's cluster even when the corrected title changes.

- [ ] **Step 2: Confirm clustering tests fail**

Run: `pnpm exec vitest run tests/domain/news-events/cluster.test.ts`

Expected: FAIL because the clustering API is absent.

- [ ] **Step 3: Implement deterministic clustering**

Export:

```ts
export interface ClusterNewsEvidenceInput {
  readonly historical: readonly NewsEvidencePayload[];
  readonly incoming: readonly UnclusteredNewsEvidencePayload[];
}

export function clusterNewsEvidence(
  input: ClusterNewsEvidenceInput
): Promise<readonly NewsEvidencePayload[]>;
```

Normalize tokens by Unicode lowercase, punctuation removal, whitespace collapse, stop-word removal, and unique sorting. Prefer exact correction targets, then exact non-null syndication IDs, then the `0.80` Jaccard/time/scope heuristic. Sort historical and incoming records by the deterministic representative tuple before unioning groups. Hash only the chosen representative identity to derive `clusterId`.

For each incoming payload, aggregate sorted unique source references and claims from its resolved group. Count independent corroboration only across distinct `(publisher.id, originatingReportId)` pairs. Preserve the incoming record as its own immutable version; do not mutate historical payloads. If any accepted record declares a conflict with another source version, set `conflicting`, add `source_disagreement`, retain both claim arrays, and apply the conflict degradation during enrichment.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run tests/domain/news-events/cluster.test.ts`

Run: `pnpm exec eslint src/domain/news-events/cluster.ts src/domain/news-events/index.ts tests/domain/news-events/cluster.test.ts`

Expected: selected tests and lint pass.

Commit: `git add src/domain/news-events/cluster.ts src/domain/news-events/index.ts tests/domain/news-events/cluster.test.ts && git commit -m "feat: cluster and corroborate news evidence"`

## Repository Targets

### Expected Files

- src/domain/news-events/cluster.ts
- src/domain/news-events/index.ts
- tests/domain/news-events/cluster.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/news-events/cluster.test.ts
pnpm exec eslint src/domain/news-events/cluster.ts src/domain/news-events/index.ts tests/domain/news-events/cluster.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **syndication is not corroboration**: Provider-declared copies share a cluster but one originating report does not raise corroboration. (Test: `provider syndication id groups copies without corroboration`)
- **order independent clustering**: Input permutation cannot change group membership, representative identity, or cluster ID. (Test: `near duplicate clustering is deterministic across input order`)
- **independent reports corroborate**: Distinct publisher and originating-report identities in one cluster produce independently corroborated evidence and retain all references. (Test: `independent publishers with distinct originating reports corroborate`)
- **conflicts stay visible**: Conflicting claim sets and references remain present with conflicting state rather than becoming consensus. (Test: `conflicting reports remain visible as conflicting evidence`)
- **corrections preserve history**: A correction inherits cluster identity, links its corrected version, and does not mutate the corrected payload. (Test: `correction appends a linked version without overwriting history`)
