# Task Context: Task 1

Title: Pin the EvidenceBundle v1 contract and implement contract conformance

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-26
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-26
Start Commit: 01ac2b377c06f834207d0e8cbb30e51ebf1e1e1e

## Task Requirements

**Files:**

- Create: `schemas/regime-engine/evidence-bundle.v1/schema.json`
- Create: `schemas/regime-engine/evidence-bundle.v1/provenance.json`
- Create: exact upstream assets under `schemas/regime-engine/evidence-bundle.v1/fixtures/`
- Create: `src/contracts/generated/evidence-bundle-v1.ts`
- Create: `src/contracts/evidence-bundle.ts`
- Modify: `src/contracts/index.ts`
- Create: `src/ports/evidence-bundle-contract.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/evidence-bundle-v1-contract.ts`
- Create: `tests/contracts/evidence-bundle-v1-contract.test.ts`
- Create: `tests/fixtures/evidence-bundle.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Behavioral invariants (write these exact tests first):**

- `rejects contract assets whose bytes do not match the provenance manifest`: recompute SHA-256 for the schema and every fixture and fail before compiling the schema if any digest differs.
- `accepts every pinned canonical valid fixture`: every upstream valid fixture passes the declared JSON Schema draft without local exceptions.
- `rejects every pinned canonical invalid fixture`: every upstream invalid fixture fails validation for the upstream-defined reason/category.
- `accepts deterministic-only evidence with empty context and no research brief`: the canonical deterministic-only fixture validates without inventing contextual or LLM evidence.
- `canonicalizes and hashes byte-for-byte like Regime Engine`: canonical text and SHA-256 exactly match the pinned golden outputs, including nested key order, arrays, Unicode, integers, and any decimal cases present upstream.
- `derives the canonical idempotency identity exactly like Regime Engine`: fixture identity fields yield the pinned key and excluded payload fields do not alter it.
- `rejects unsupported schema versions before canonicalization`: any value other than the pinned `evidence-bundle.v1` version returns a typed contract error.

- [ ] **Step 1: Verify the contract gate.** Read the completed pin block in `issue.md`; verify the merged commit, exact paths, schema version, hashes, fixture coverage, license/repository policy, and deterministic-only semantics. Abort without modifying source files if any item is absent, ambiguous, mutable, or incompatible.
- [ ] **Step 2: Copy the exact upstream bytes and write provenance.** Preserve fixture bytes verbatim. In `provenance.json`, record `repository`, `commit`, `schemaPath`, `schemaVersion`, `copiedAt`, and an `assets` array of `{ sourcePath, localPath, sha256 }`. Do not normalize copied JSON before hashing.
- [ ] **Step 3: Generate the checked-in TypeScript type.** Generate `EvidenceBundleV1` from the pinned schema using a deterministic package script; the generated file must include its schema hash in a header and must not contain hand-edited fields. Add a drift check that regenerates to a temporary path and compares the result.
- [ ] **Step 4: Define the narrow contract port and typed errors.** Export `EvidenceBundleContract`, `CanonicalEvidenceBundle`, and `EvidenceBundleContractError`. The operation accepts `unknown`, validates it, returns the schema-typed payload plus exact canonical text/hash/idempotency key, and never selects evidence or calculates quality.

```ts
export interface CanonicalEvidenceBundle {
  readonly payload: EvidenceBundleV1;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly schemaVersion: "evidence-bundle.v1";
}

export interface EvidenceBundleContract {
  validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle>;
}
```

- [ ] **Step 5: Implement the Node contract adapter.** Compile the exact declared JSON Schema draft, reject unsupported formats/keywords rather than silently ignoring them, use the upstream-mandated canonicalization and identity algorithm, and hash the UTF-8 bytes of the returned canonical string. Reuse `src/domain/content-hash.ts` only if the golden fixtures prove exact equivalence; otherwise leave that existing helper unchanged and use the mandated algorithm solely in this adapter.
- [ ] **Step 6: Run focused conformance checks.** Expected: asset hashes, valid/invalid fixtures, deterministic-only fixture, canonical bytes, payload hashes, identity keys, generated-type drift, lint, and formatting all pass.

**Validation commands:**

```bash
pnpm exec vitest run tests/contracts/evidence-bundle-v1-contract.test.ts
pnpm exec eslint src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts --max-warnings 0
pnpm exec prettier --check schemas/regime-engine/evidence-bundle.v1 src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts package.json pnpm-lock.yaml
pnpm run contract:evidence-bundle:check
```

**Commit:** `feat: pin evidence bundle v1 contract`

## Repository Targets

### Expected Files

- schemas/regime-engine/evidence-bundle.v1/schema.json
- schemas/regime-engine/evidence-bundle.v1/provenance.json
- schemas/regime-engine/evidence-bundle.v1/fixtures/
- src/contracts/generated/evidence-bundle-v1.ts
- src/contracts/evidence-bundle.ts
- src/contracts/index.ts
- src/ports/evidence-bundle-contract.ts
- src/ports/index.ts
- src/adapters/node/evidence-bundle-v1-contract.ts
- tests/contracts/evidence-bundle-v1-contract.test.ts
- tests/fixtures/evidence-bundle.ts
- package.json
- pnpm-lock.yaml

## Validation Commands

```bash
pnpm exec vitest run tests/contracts/evidence-bundle-v1-contract.test.ts
pnpm exec eslint src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts --max-warnings 0
pnpm exec prettier --check schemas/regime-engine/evidence-bundle.v1 src/contracts/generated/evidence-bundle-v1.ts src/contracts/evidence-bundle.ts src/contracts/index.ts src/ports/evidence-bundle-contract.ts src/ports/index.ts src/adapters/node/evidence-bundle-v1-contract.ts tests/contracts/evidence-bundle-v1-contract.test.ts tests/fixtures/evidence-bundle.ts package.json pnpm-lock.yaml
pnpm run contract:evidence-bundle:check
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **contract asset integrity**: Schema and fixture bytes must match every SHA-256 recorded in the provenance manifest before schema compilation. (Test: `rejects contract assets whose bytes do not match the provenance manifest`)
- **canonical valid fixtures**: Every pinned upstream valid fixture validates against the exact declared JSON Schema draft. (Test: `accepts every pinned canonical valid fixture`)
- **canonical invalid fixtures**: Every pinned upstream invalid fixture is rejected without local validation exceptions. (Test: `rejects every pinned canonical invalid fixture`)
- **deterministic-only compatibility**: Empty or unavailable context and an absent brief use the canonical representation and still validate. (Test: `accepts deterministic-only evidence with empty context and no research brief`)
- **canonical byte equivalence**: Canonical text and its SHA-256 are byte-for-byte equal to Regime Engine golden fixtures. (Test: `canonicalizes and hashes byte-for-byte like Regime Engine`)
- **canonical idempotency identity**: Only upstream-defined logical identity fields determine the idempotency key. (Test: `derives the canonical idempotency identity exactly like Regime Engine`)
- **schema version gate**: Unsupported schema versions fail before canonicalization or hashing. (Test: `rejects unsupported schema versions before canonicalization`)
