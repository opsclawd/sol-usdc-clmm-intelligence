# Task Context: Task 5

Title: Expose the collector through a job, CLI, configuration, and documentation

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-27
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-27
Start Commit: 8d258115c27c92c40909384db9d08dca77ae3750

## Task Requirements

**Files:**

- Create: `src/jobs/support-resistance-job.ts`
- Modify: `src/jobs/index.ts`
- Create: `scripts/collectors/support-resistance.ts`
- Create: `tests/jobs/support-resistance-job.test.ts`
- Create: `tests/scripts/support-resistance.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md` only in scripts/configuration/contextual-collector sections
- Modify: `docs/architecture.md` only in pipeline/component-flow sections
- Modify: `docs/operator-runbook.md` only in collector commands and degraded-outcome guidance

**Exported API changes:** add `SupportResistanceJobDeps`, `supportResistanceJob`, and `runSupportResistanceJob` exports. The Node runtime interface remains unchanged; the CLI constructs `HttpSupportResistanceSource` from `runtime.http` and non-secret environment configuration, then supplies existing persistence/runtime dependencies to the job.

- [ ] **Step 1: Write job and CLI tests first.**

  Add exact cases:
  - `creates one collection run context and delegates to the support resistance use case`
  - `prints a structured accepted result and exits zero when usable contextual evidence exists`
  - `prints a structured degraded result and exits zero when raw evidence is retained but no level is usable`
  - `exits nonzero for conflict malformed timeout network unavailable and failed outcomes without printing secrets`

  Mock the job in the script test and mock `createNodeRuntime` with HTTP, env, clock, run-ID factory, and persistence. Assert the adapter reads `SUPPORT_RESISTANCE_API_URL` and optional `SUPPORT_RESISTANCE_API_KEY`, but structured output redacts secret-looking keys and values using the established collector redaction pattern.

- [ ] **Step 2: Run job/CLI tests and confirm they fail.**

  Run: `pnpm exec vitest run tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts`

  Expected: FAIL because the job and script do not exist.

- [ ] **Step 3: Implement the job and thin script.**

  `runSupportResistanceJob` creates one context with `createCollectionRunContext` and delegates. Add package script `collect:support-resistance` with command `tsx scripts/collectors/support-resistance.ts`. The CLI prints the result as formatted JSON, sets exit code `0` for accepted, identical replay, stale, or degraded outcomes, and `1` for conflict, malformed, timeout, network, unavailable, or failed outcomes. It must not publish, retry in a loop, or write local snapshots.

- [ ] **Step 4: Document configuration, operation, and authority boundary.**

  Add these environment entries with blank safe defaults:

  ```dotenv
  SUPPORT_RESISTANCE_API_URL=
  SUPPORT_RESISTANCE_API_KEY=
  ```

  Update the scoped README sections with the raw-to-normalized flow, point/zone distinction, bounded extracts, exact replay behavior, `allow_context_only` semantics, and `pnpm collect:support-resistance`. Update architecture documentation to place the source port/adapter and new application use case in their proper layers. Update the operator runbook with accepted/degraded/stale/failure exit behavior and the instruction that missing or expired levels never become execution authority.

- [ ] **Step 5: Run focused verification.**

  Run: `pnpm exec vitest run tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts`

  Expected: PASS for context creation, dependency wiring, exit status, structured output, and secret redaction.

  Run: `pnpm exec eslint src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts package.json .env.example README.md docs/architecture.md docs/operator-runbook.md`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 6: Commit the runnable/documented slice.**

  ```bash
  git add src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts package.json .env.example README.md docs/architecture.md docs/operator-runbook.md
  git commit -m "feat: expose support resistance collector"
  ```

### Tests to add or update

- Contract/type tests for strict point/zone discrimination and explicit `USDC_PER_SOL` units.
- Taxonomy registry tests for contextual classification, freshness, confidence, and allowed source provenance.
- Pure domain tests for bounded retention, validation, normalization, missing/malformed levels, deterministic equivalence, stale behavior, confidence, and provenance.
- Adapter tests for request shaping, optional credentials, bounded projection, error classification, and secret-safe diagnostics.
- Application state-transition tests covering accepted, degraded, stale, replay recovery, conflict, unavailable, failed normalization, same-run equivalence, and cross-provider independence.
- Drizzle integration tests demonstrating that existing JSONB tables round-trip the new payload and keep idempotent versus distinct rows correctly.
- Job and CLI tests for run-context wiring, structured output, exit behavior, and redaction.

### Validation commands after all implementation tasks

The orchestrator automatically runs workspace-wide `pnpm -r typecheck` after each task. After all five implementation tasks, the dedicated validate phase should run the repository-standard commands; these are not a standalone implementation task:

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm boundaries
```

Expected: all commands exit 0. The database integration file may report its cases skipped when `DATABASE_URL` is not configured; with a test database configured, those cases must pass.

### Risk areas

- **Licensing/retention:** retaining arbitrary response objects could copy prohibited source content. The adapter/domain boundary must rebuild an allowlisted snapshot and hard-cap each extract at 500 characters before canonical persistence.
- **False consensus:** omitting provider/run, side, timeframe, type, or thesis from equivalence identity could merge distinct assertions. Identity tests lock each dimension.
- **Numeric ambiguity:** coercing prose or malformed strings into numbers could fabricate levels. Only finite positive explicit numeric fields are accepted; mixed point/zone and inverted zone shapes are rejected.
- **Replay semantics:** a parsed replay reports zero newly inserted rows, so the result must recover its linked normalized evidence rather than report no usable data.
- **State recovery:** raw rows can remain pending/failed after downstream persistence errors. Replay must validate stored bounded canonical content and rely on normalized uniqueness for safe recovery.
- **Freshness/confidence:** source expiry must participate in `computeFreshness`, and stale confidence must degrade while remaining contextual-only.
- **Credential leakage:** API credentials may appear only in outbound headers and must be absent from canonical payloads, request metadata, diagnostics, and CLI output.
- **Provider specificity:** the first adapter assumes a provider-neutral response contract. Provider-specific field mapping beyond that contract is a later adapter, not permissive parsing in this slice.

### Stop conditions

Abort implementation and report the blocker instead of broadening scope if any of these occur:

- The target provider cannot legally supply/store the proposed bounded fields or references under its license.
- The real provider response cannot supply explicit numeric point/zone values, timeframe, provider/run identity, source references, as-of time, and expiry without inference.
- Regime Engine requires a different canonical evidence/publish contract in this PR; that is cross-repo scope and needs a separate design decision.
- Existing database constraints cannot persist multiple normalized claims from one raw observation without migration. Do not silently change identity semantics or add a migration without revisiting the design.
- Implementing the port reveals another production adapter or fake required by the compiler beyond the two listed in Task 3. Keep the interface and every implementation in one atomic task before continuing.
- A planned task would require storing credentials, full copyrighted articles, or unbounded provider payloads.
- The automatic workspace typecheck fails because of an unrelated pre-existing worktree change; preserve user changes and report the exact failure rather than modifying unrelated files.

### Assumptions

- `issue-comments.md` is intentionally empty and adds no requirements.
- One configurable provider-neutral `technical-analysis-api` adapter is the first PR-sized source implementation; additional concrete providers can implement the same port later.
- The existing `raw_observations` and `normalized_observations` JSONB columns and normalized uniqueness key are authoritative and need no migration.
- Source reliability is provider-supplied configuration/data constrained to `[0, 1]`; it is metadata, not a deterministic fact, and confidence cannot exceed it.
- Distinct provider runs are historical observations that expire naturally; this slice does not add a supersession column.
- Missing-level claims are retained in bounded raw evidence and surfaced as degraded warnings, but never become normalized numeric evidence.

## Repository Targets

### Expected Files

- src/jobs/support-resistance-job.ts
- src/jobs/index.ts
- scripts/collectors/support-resistance.ts
- tests/jobs/support-resistance-job.test.ts
- tests/scripts/support-resistance.test.ts
- package.json
- .env.example
- README.md
- docs/architecture.md
- docs/operator-runbook.md

## Validation Commands

```bash
pnpm exec vitest run tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts
pnpm exec eslint src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts --max-warnings 0
pnpm exec prettier --check src/jobs/support-resistance-job.ts src/jobs/index.ts scripts/collectors/support-resistance.ts tests/jobs/support-resistance-job.test.ts tests/scripts/support-resistance.test.ts package.json .env.example README.md docs/architecture.md docs/operator-runbook.md
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **single-run-context**: Each job invocation creates exactly one collection context and delegates once. (Test: `creates one collection run context and delegates to the support resistance use case`)
- **usable-success-exit**: Accepted usable contextual evidence prints a structured result and exits zero. (Test: `prints a structured accepted result and exits zero when usable contextual evidence exists`)
- **degraded-raw-success-exit**: Retained degraded raw evidence with no fabricated level remains observable and exits zero. (Test: `prints a structured degraded result and exits zero when raw evidence is retained but no level is usable`)
- **terminal-failure-safe-exit**: Conflict, malformed, timeout, network, unavailable, and failed outcomes exit nonzero and never print configured secrets. (Test: `exits nonzero for conflict malformed timeout network unavailable and failed outcomes without printing secrets`)
