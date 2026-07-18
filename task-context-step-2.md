# Task Context: Task 2

Title: Canonicalize accepted JSON and derive source identity

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-22
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-22
Start Commit: 354e656925912cc7e58de7220277b1694b69286d

## Task Requirements

**Files:**

- Modify: `src/domain/content-hash.ts`
- Modify: `tests/domain/content-hash.test.ts`
- Create: `src/domain/clmm-bundle/identity.ts`
- Modify: `src/domain/clmm-bundle/index.ts`
- Create: `tests/domain/clmm-bundle/identity.test.ts`

**Behavioral invariants to test first:**

- `canonical payload hash is the SHA-256 of the returned canonical string` prevents storage/hash serializer drift.
- `canonical JSON sorts object keys recursively and preserves array order` defines deterministic content semantics.
- `canonical JSON rejects undefined sparse arrays NaN Infinity and unsupported JSON values` prevents lossy acceptance.
- `source observation key is stable for the same version wallet pair pool and observed time` defines replay identity.
- `source observation key changes when wallet pool pair observation time or identity version changes` prevents unrelated observations from collapsing.

- [ ] **Step 1: Extend the existing hash tests and add identity tests before implementation.** Keep the existing `canonicalHash` compatibility coverage and assert exact canonical strings as well as 64-character lowercase hashes.
- [ ] **Step 2: Run `pnpm vitest run tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts`; expect missing exports and invalid-value cases to fail.**
- [ ] **Step 3: Replace the private serializer with one strict exported operation while retaining `canonicalHash`:**

```ts
export interface CanonicalPayload {
  payloadCanonical: string;
  payloadHash: string;
}

export async function canonicalizePayload(payload: unknown): Promise<CanonicalPayload>;
export async function canonicalHash(payload: unknown): Promise<string>;
```

`canonicalHash` must delegate to `canonicalizePayload`. Reject values that JSON cannot represent exactly rather than silently dropping/coercing them.

- [ ] **Step 4: Implement `deriveClmmSourceObservationKey` over the canonical identity tuple `{ identityVersion: 1, walletId, pair, poolId, observedAtUnixMs }`; return only its SHA-256 hash.** Keep the raw tuple out of indexed storage.
- [ ] **Step 5: Export the identity helper and rerun the two focused test files, then lint/format only the five scoped files.** Run `pnpm exec eslint src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts --max-warnings 0` and the matching `pnpm exec prettier --check ...` paths.
- [ ] **Step 6: Commit:** `git add src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts && git commit -m "feat(clmm): define canonical payload identity"`.

## Repository Targets

### Expected Files

- src/domain/content-hash.ts
- tests/domain/content-hash.test.ts
- src/domain/clmm-bundle/identity.ts
- src/domain/clmm-bundle/index.ts
- tests/domain/clmm-bundle/identity.test.ts

## Validation Commands

```bash
pnpm vitest run tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts
pnpm exec eslint src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/content-hash.ts src/domain/clmm-bundle/identity.ts src/domain/clmm-bundle/index.ts tests/domain/content-hash.test.ts tests/domain/clmm-bundle/identity.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical hash coupling**: The stored payload hash is SHA-256 of exactly the canonical string returned by the same operation. (Test: `canonical payload hash is the SHA-256 of the returned canonical string`)
- **canonical ordering**: Object keys sort recursively while array order remains unchanged. (Test: `canonical JSON sorts object keys recursively and preserves array order`)
- **strict JSON domain**: Unsupported or lossy JSON values are rejected instead of dropped or coerced. (Test: `canonical JSON rejects undefined sparse arrays NaN Infinity and unsupported JSON values`)
- **source identity stability**: The versioned wallet, pair, pool, and observed-time tuple deterministically identifies one source observation. (Test: `source observation key is stable for the same version wallet pair pool and observed time`)
- **source identity sensitivity**: Changing any identity component changes the source observation key. (Test: `source observation key changes when wallet pool pair observation time or identity version changes`)
