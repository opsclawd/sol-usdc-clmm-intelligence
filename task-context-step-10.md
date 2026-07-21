# Task Context: Task 10

Title: Wire the runtime job, replay script, and operator documentation

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

- Modify: `src/adapters/node/composition-root.ts`
- Create: `src/jobs/assemble-evidence-bundle-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/assemble-evidence-bundle.ts`
- Create: `tests/scripts/assemble-evidence-bundle.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

**Behavioral invariants (write these exact tests first):**

- `runtime composes the bundle repository and pinned contract adapter`: `getPersistence()` supplies all five repositories and the runtime supplies the v1 contract service without eager database access.
- `job forwards an explicit immutable assembly request unchanged`: the job adds no clock, run ID, wallet, version, or timestamp defaults.
- `script parses required inputs and prints a redacted outcome summary`: output contains outcome, row ID when present, payload hash, coverage counts, and warning codes, but not wallet ID or canonical payload.
- `replaying the same input file preserves run and creation identity`: the script sends the same request bytes/values and permits `identical_replay`.
- `invalid input exits before database composition`: malformed JSON, missing required identity/version fields, or wrong pair produces a non-zero exit and no repository access.

- [ ] **Step 1: Add failing script/job boundary tests.** Invoke the script's exported `main` with fake dependencies and captured stdout/stderr; do not spawn a real process or database.
- [ ] **Step 2: Complete composition atomically.** Extend exported `Persistence` with `bundleRepo`, instantiate `DrizzleBundleRepo` in `getPersistence`, expose the `EvidenceBundleContract` from `NodeRuntime`, and instantiate the pinned adapter. Because `Persistence` and `NodeRuntime` are exported interfaces, update their implementation in this same task.
- [ ] **Step 3: Add the thin job and script.** The script accepts one repository-relative JSON request path, validates it through the application request parser, obtains persistence lazily, invokes the job once, emits redacted JSON, and sets a non-zero exit code for hard failure/conflict. Add `assemble:bundle` to `package.json`.
- [ ] **Step 4: Document contract provenance and replay.** In README/architecture/runbook, document the pinned schema commit/hash/update procedure, seven-slot selection and expiry rules, quality/coverage vocabulary, lineage verification, canonical hash/idempotency semantics, migration precondition, exact request-file example, exact replay behavior, redacted output, and the boundary that future publishing must send stored `payloadCanonical` without reassembly.
- [ ] **Step 5: Run focused checks.** Expected: script tests pass, runtime remains lazy, examples match the request/result types, and dependency boundaries remain valid for the new source paths.

**Validation commands:**

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec eslint src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts --max-warnings 0
pnpm exec prettier --check src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts package.json README.md docs/architecture.md docs/operator-runbook.md
pnpm exec depcruise --config .dependency-cruiser.cjs src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts
```

**Commit:** `feat: expose deterministic bundle assembly workflow`

**Tests added or updated**

- Contract conformance: pinned asset hashes, JSON Schema valid/invalid fixtures, deterministic-only validity, canonical bytes/hash/idempotency goldens, and generated-type drift.
- Pure domain: seven-slot selection, dynamic freshness, scope/version filtering, status/value handling, lineage integrity, stable ordering, quality/coverage, timestamps, confidence, empty context, absent brief, and canonical candidate mapping.
- Repository contracts: bounded feature reads, bulk normalized/raw lineage reads, exact replay/conflict classification, and JSONB/canonical-text consistency.
- Database: migration abort behavior, new columns/indexes/constraints, and concurrent identical/conflicting inserts.
- Application/script: complete and degraded assembly, no-usable stop, fail-before-write behavior, replay/conflict outcomes, explicit request forwarding, and redacted output.

**Risk areas**

- The upstream contract is not currently pinned; any implementation before that is contract invention.
- JSON canonicalization, Unicode, and decimal rendering can diverge across libraries even when parsed JSON is equivalent; golden byte/hash fixtures are mandatory.
- Historical `evidence_bundles` rows cannot safely receive fabricated canonical text or identity keys; the migration intentionally aborts when they exist unless a separately approved data migration proves them.
- Wallet identity exists only in raw clmm-v2 payload lineage, so trusting the request alone could create cross-wallet evidence.
- Persisted `isStale` reflects derivation time and can be wrong at later assembly time; expiration must be evaluated again.
- Candidate query bounds must be broad enough to retain expired-only and unsupported-version-only diagnostics while remaining operationally bounded.
- Concurrent insert classification depends on the exact logical unique index and a reliable winner reload; a disappearing winner is an integrity failure.
- Canonical payloads and wallet/position identifiers are sensitive; CLI output and errors must stay redacted.
- Partial bundle persistence must follow both the pinned schema and repository fail-closed posture; zero usable evidence defaults to no bundle.

**Stop conditions**

- Abort before Task 1 if `issue.md` lacks the merged Regime Engine SHA, exact schema/fixture paths, schema version, and SHA-256 values, or if those assets cannot be copied under repository policy.
- Abort if the pinned schema/fixtures do not validate deterministic-only bundles with canonical contextual absence and no research brief.
- Abort if canonicalization, payload hashing, idempotency identity, timestamp boundaries, or any required aggregate quality/confidence formula is not unambiguously specified and fixture-covered upstream.
- Abort if copied asset hashes differ from the issue pin or generated types cannot represent the deterministic-only fixture exactly.
- Abort the migration if historical `evidence_bundles` rows exist and no separately approved, provably correct canonical backfill is supplied.
- Abort assembly before persistence on invalid request identity, unsupported schema/version configuration, zero usable evidence (unless upstream explicitly mandates persistence), missing/corrupt lineage, wallet/position/pool contradiction, schema validation failure, canonicalization failure, or JSONB/canonical-text mismatch.
- Abort rather than overwrite on same logical identity with different canonical content, and abort rather than retry on database integrity failures in this issue.

**Plan review classification**

This plan requires review because it introduces an irreversible database write and explicit inserted/replay/conflict state transitions. The first-line `plan-review-required` marker is therefore present.

## Repository Targets

### Expected Files

- src/adapters/node/composition-root.ts
- src/jobs/assemble-evidence-bundle-job.ts
- src/jobs/index.ts
- scripts/collectors/assemble-evidence-bundle.ts
- tests/scripts/assemble-evidence-bundle.test.ts
- package.json
- README.md
- docs/architecture.md
- docs/operator-runbook.md

## Validation Commands

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec eslint src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts --max-warnings 0
pnpm exec prettier --check src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts src/jobs/index.ts scripts/collectors/assemble-evidence-bundle.ts tests/scripts/assemble-evidence-bundle.test.ts package.json README.md docs/architecture.md docs/operator-runbook.md
pnpm exec depcruise --config .dependency-cruiser.cjs src/adapters/node/composition-root.ts src/jobs/assemble-evidence-bundle-job.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **runtime composition**: The runtime exposes the bundle repository and v1 contract service without eager database access. (Test: `runtime composes the bundle repository and pinned contract adapter`)
- **immutable request forwarding**: The job forwards the explicit request without adding identity, version, or time defaults. (Test: `job forwards an explicit immutable assembly request unchanged`)
- **redacted script output**: CLI output contains only operational summary fields and excludes wallet identity and canonical payload. (Test: `script parses required inputs and prints a redacted outcome summary`)
- **replay input stability**: Reusing the same request file preserves run and creation identity for exact replay. (Test: `replaying the same input file preserves run and creation identity`)
- **invalid input short circuit**: Malformed or incomplete input exits non-zero before database composition. (Test: `invalid input exits before database composition`)
