# Task 7 Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the P1, P2, P3 review findings for Task 7 (Pyth oracle updates collection & ingestion).

**Architecture:**

1. Add `orderBy` ascending in `findBySource` query to ensure deterministic order in `DrizzleNormalizedObservationRepo`.
2. Add `findLatestByKind` to `NormalizedObservationRepo` interface and implement it in drizzle and fake repos, replacing the lookback query in `collectPythPrice`.
3. Cache `normalizePythPrice` candidates in `collectPythPrice` to avoid duplicate computation on the hot path.
4. Clean up duplicate branch for `http_status` in `mapHttpError`.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest

## Global Constraints

- Preserve boundary rules enforced by `dependency-cruiser`
- Run `pnpm verify` to confirm formatting, linting, type-checking, and tests pass before committing

---

### Task 1: Drizzle Repository and Port Updates

**Files:**

- Modify: `src/ports/normalized-observation-repo.ts`
- Modify: `src/adapters/node/drizzle-normalized-observation-repo.ts`
- Modify: `tests/fakes/fake-normalized-observation-repo.ts`

**Interfaces:**

- Produces: `findLatestByKind(source: Source, observationKind: ObservationKind): Promise<NormalizedObservationRow | null>`

- [ ] **Step 1: Update the NormalizedObservationRepo interface**
      Add `findLatestByKind` signature to [normalized-observation-repo.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23/src/ports/normalized-observation-repo.ts).

- [ ] **Step 2: Add asc and desc sort to findBySource and implement findLatestByKind in drizzle repository**
      Update [drizzle-normalized-observation-repo.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23/src/adapters/node/drizzle-normalized-observation-repo.ts):
  - Import `asc` and `desc` from `"drizzle-orm"`.
  - Add `.orderBy(asc(normalizedObservations.receivedAtUnixMs))` to `findBySource`.
  - Implement `findLatestByKind` using `.orderBy(desc(normalizedObservations.receivedAtUnixMs)).limit(1)`.

- [ ] **Step 3: Update fake repository**
      Implement `findLatestByKind` and sort results in `findBySource` within [fake-normalized-observation-repo.ts](file:///home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23/tests/fakes/fake-normalized-observation-repo.ts).

- [ ] **Step 4: Run unit tests to verify no compilation/test issues**
      Run: `pnpm test`

---

### Task 2: Optimize collectPythPrice Application Logic

**Files:**

- Modify: `src/application/collect-pyth-price.ts`

- [ ] **Step 1: Optimize database retrieval and eliminate duplicate parsing**
      Update `collectPythPrice` to:
  - Cache the result of `normalizePythPrice` in `firstCandidate` to avoid calling it twice.
  - Call `normalizedObservationRepo.findLatestByKind` instead of the 5-minute lookback range query.
  - Unify the `http_status` check in `mapHttpError` to remove redundant branches.

- [ ] **Step 2: Run verification**
      Run: `pnpm verify`

- [ ] **Step 3: Commit**
      Run: `/usr/bin/git add -A && /usr/bin/git commit -m "fix: review findings for Task 7"`
