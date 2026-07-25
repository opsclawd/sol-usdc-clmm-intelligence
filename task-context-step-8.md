# Task Context: Task 8

Title: Schedule and document the Pack C routine

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-11
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-11
Start Commit: d62ccad6f3f1f0812dc1d59b322256f63fbcf7ba

## Task Requirements

**Files:**

- Create: `cron/routines/perp-liquidation.md`
- Modify: `cron/jobs.yaml`
- Modify: `tests/regression/cron-render.fixture.test.ts` (new Pack C fixture-backed case only)
- Create: `tests/fixtures/cron/routines/perp-liquidation.md`
- Create: `tests/fixtures/cron/perp-liquidation-jobs.yaml`

- [ ] **Step 1: Write a failing focused cron rendering test**

  Add a separate fixture and case named `renders the five-minute perp liquidation routine with the bounded collector command`. Assert the rendered command uses the routine file and that the routine says `pnpm collect:perp-liquidation`.

- [ ] **Step 2: Verify the focused cron test fails**

  Run: `pnpm vitest run tests/regression/cron-render.fixture.test.ts -t "renders the five-minute perp liquidation routine with the bounded collector command"`

  Expected: FAIL because the Pack C fixture/routine/job is absent.

- [ ] **Step 3: Add the routine and schedule**

  Register:

  ```yaml
  - name: perp-liquidation
    cron: "*/5 * * * *"
    messageFile: cron/routines/perp-liquidation.md
  ```

  The routine must describe the two-source allowlist, metric coverage, five-minute polling, four-hour OI and one-hour liquidation windows, exit statuses, freshness/confidence degradation, the Binance liquidation limitation, and the authority boundary. It must explicitly say that unavailable coverage is not evidence of no risk.

- [ ] **Step 4: Run the focused cron test and formatting**

  Run: `pnpm vitest run tests/regression/cron-render.fixture.test.ts -t "renders the five-minute perp liquidation routine with the bounded collector command"`

  Expected: PASS.

  Run: `pnpm exec prettier --check cron/jobs.yaml cron/routines/perp-liquidation.md tests/regression/cron-render.fixture.test.ts tests/fixtures/cron/routines/perp-liquidation.md tests/fixtures/cron/perp-liquidation-jobs.yaml`

  Expected: exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add cron/jobs.yaml cron/routines/perp-liquidation.md tests/regression/cron-render.fixture.test.ts tests/fixtures/cron/routines/perp-liquidation.md tests/fixtures/cron/perp-liquidation-jobs.yaml
  git commit -m "feat: schedule perp liquidation evidence collection"
  ```

## Tests to add or update

- Contract/taxonomy: all new source, observation, payload, feature, confidence, freshness, and provenance definitions.
- Adapter: endpoint mapping, precision handling, per-metric partial coverage, retry classification, and diagnostic redaction.
- Domain: validation, normalization, identity, stale enrichment, signed rates, rising/falling OI, basis, liquidation clustering, unavailable denominators, deterministic lineage, and idempotent keys.
- Persistence: derived-feature allowlist/unit/scope checks and a non-destructive migration.
- Application: raw/normalized/feature ordering, replay, immutable conflict, malformed fact isolation, and degraded coverage.
- Job/script: two-source state reduction, configuration validation, exit codes, cleanup, and redaction.
- Cron: five-minute registration and routine command rendering.

## Validation commands

Each task includes its own path-scoped acceptance commands. After all implementation tasks, the orchestrator’s dedicated validate phase should run the repository gates (this is not a standalone implementation task):

```bash
pnpm -r typecheck
pnpm verify
```

Expected: both commands exit 0. If the repository is a single package, `pnpm -r typecheck` still exercises the automatic workspace-wide signature gate.

## Risk areas

- **Source feasibility:** Binance public REST does not provide market-wide liquidations through the documented user force-orders endpoint. Drift public liquidation history is therefore required for acceptance.
- **Drift precision drift:** integer precision or response shape changes can silently change notional values. Parse only documented/configured precision and reject unknown versions.
- **Venue symbol mismatch:** Binance may list `SOLUSDT` rather than `SOLUSDC`; configuration must identify the stablecoin contract while the canonical evidence pair remains `SOL/USDC`, and metadata must disclose the quote proxy if it is not USDC.
- **Partial endpoint failure:** concurrent metric requests must retain successful facts while reporting failed coverage, without equating missing data to zero.
- **Stale evidence:** retaining stale observations is intentional, but confidence reasons/status must prevent stale values from appearing fully available.
- **Duplicate liquidation records:** retries and overlapping windows must share stable provider identities or cluster values will double count.
- **Unsafe numeric conversion:** rates and notionals may exceed floating-point precision; decimal strings and integer arithmetic are mandatory.
- **Database migration:** dropping/recreating checks can block deployment if the replacement check conflicts with historical rows. The migration must only broaden accepted kinds and preserve existing constraints.
- **Persistence ordering:** feature insertion after normalized writes is an irreversible DB side effect; a failure can leave observations without features. Replay must deterministically complete the missing feature step.
- **Rate limits:** five-minute polling across several endpoints needs bounded retries and per-metric degradation to avoid synchronized retry storms.

## Stop conditions

Abort implementation instead of improvising when any of the following is true:

- Drift’s approved public, read-only API/RPC cannot provide auditable historical SOL-PERP liquidation records with stable IDs, timestamps, market identity, and defensible notional precision.
- Satisfying liquidation coverage would require a private key, transaction signing, Binance `USER_DATA`, an authenticated trading account, or a persistent WebSocket service.
- The configured Binance instrument is not a defensible SOL stablecoin perpetual proxy and no approved mapping is supplied.
- Official source documentation does not define the precision or semantics required to normalize funding, OI, price, or liquidation values.
- The generated database migration deletes/rewrites historical rows, weakens existing constraints, or cannot be applied without destructive manual repair.
- The canonical database/evidence contract cannot represent all four features in BPS without a downstream regime-engine contract change; that expansion belongs in a separately coordinated issue.
- Existing unrelated test/typecheck failures make it impossible to distinguish Pack C regressions; record the exact baseline failures and stop.
- Source terms prohibit the planned retention or use of the returned data.

## Implementation notes

- Write the named invariant test first in every stateful or calculation task, observe the focused failure, then write minimal implementation.
- Keep raw venue response types private to each adapter. The port, domain, application, fixtures, and persisted normalized payloads may contain only canonical source facts/contracts.
- Preserve user changes already present in the worktree. Do not rewrite unrelated collector code to share abstractions unless a failing Pack C test requires it.
- Commit after each numbered task only when its focused tests pass and the automatic `pnpm -r typecheck` gate passes.

## Repository Targets

### Expected Files

- cron/routines/perp-liquidation.md
- cron/jobs.yaml
- tests/regression/cron-render.fixture.test.ts
- tests/fixtures/cron/routines/perp-liquidation.md
- tests/fixtures/cron/perp-liquidation-jobs.yaml

## Validation Commands

```bash
pnpm vitest run tests/regression/cron-render.fixture.test.ts -t "renders the five-minute perp liquidation routine with the bounded collector command"
pnpm exec prettier --check cron/jobs.yaml cron/routines/perp-liquidation.md tests/regression/cron-render.fixture.test.ts tests/fixtures/cron/routines/perp-liquidation.md tests/fixtures/cron/perp-liquidation-jobs.yaml
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded cron routine**: The five-minute cron entry renders a routine that invokes only the bounded Pack C collector. (Test: `renders the five-minute perp liquidation routine with the bounded collector command`)
