# Task Context: Task 5

Title: Implement raw-first per-event collection

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-10
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-10
Start Commit: dfdc6c6a72b0862f77922bc0061053324d906eef

## Task Requirements

**Files:**

- Create: `src/application/collect-on-chain-flow.ts`
- Create: `tests/application/collect-on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `large event transitions absent to raw pending to normalized and raw parsed`: raw insert precedes normalized insert and the result is accepted.
- `identical duplicate transitions parsed to identical replay without normalized insert`: replay produces no duplicate raw or normalized row.
- `same identity with changed payload transitions to conflict and failed`: the existing immutable row is preserved.
- `below-threshold event remains absent`: neither repository is called.
- `malformed-only snapshot remains absent and returns malformed`: no raw row is written.
- `valid event followed by malformed event preserves the valid write and returns partial`: per-event failures do not roll back earlier immutable facts.
- `empty snapshot returns accepted with zero counts`: no-event is not treated as unavailable.
- `stale qualifying event is retained raw and normalized but returns degraded`: stale context is visible and cannot masquerade as fresh evidence.
- `CEX proxy below address-quality threshold remains absent`: defensibility gate runs before persistence.

- [ ] **Step 1: Write the failing application tests**

  Use the existing fake raw/normalized repositories and `FakeOnChainFlowSource`. Assert call ordering as well as returned counts/IDs.

  Run:

  ```bash
  pnpm test tests/application/collect-on-chain-flow.test.ts
  ```

  Expected: FAIL because `collectOnChainFlow` does not exist.

- [ ] **Step 2: Implement collection**

  Export:

  ```ts
  collectOnChainFlow(
    deps: CollectOnChainFlowDeps,
    context: CollectionRunContext,
    input: { source: "helius-api" | "birdeye-api"; thresholds: OnChainFlowThresholds; lookbackMs: number }
  ): Promise<OnChainFlowCollectionResult>
  ```

  Fetch one bounded window ending at `context.startedAtUnixMs`. For each returned event: validate; apply threshold/attribution gates; normalize; derive stable identity; canonicalize the accepted source event; and call `ingestRawObservation` with an enrichment callback and normalized insert callback. Process in deterministic event-identity order. Track `accepted`, `filtered`, `replayed`, and `failed` counts plus failed source IDs. Redact diagnostics. Return `accepted | partial | degraded | identical_replay | malformed | timeout | network | unavailable | failed`.

  The lifecycle is:

  ```text
  source event -> validate -> threshold gate -> raw pending
    -> normalize/enrich -> normalized insert -> raw parsed
  ```

  A validation failure occurs before `raw pending`; an enrichment/persistence failure after raw insertion marks that raw row `failed`.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-on-chain-flow.test.ts
  pnpm exec eslint src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts --max-warnings 0
  pnpm exec prettier --check src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts
  git commit -m "feat: collect raw-first on-chain flow evidence"
  ```

## Repository Targets

### Expected Files

- src/application/collect-on-chain-flow.ts
- tests/application/collect-on-chain-flow.test.ts

## Validation Commands

```bash
pnpm test tests/application/collect-on-chain-flow.test.ts
pnpm exec eslint src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts --max-warnings 0
pnpm exec prettier --check src/application/collect-on-chain-flow.ts tests/application/collect-on-chain-flow.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **successful raw-first transition**: A qualifying event transitions through raw pending, normalized insertion, and raw parsed in order. (Test: `large event transitions absent to raw pending to normalized and raw parsed`)
- **identical replay transition**: A parsed identical replay creates no additional normalized row. (Test: `identical duplicate transitions parsed to identical replay without normalized insert`)
- **immutable conflict**: Changed payload under the same identity fails without overwriting the stored row. (Test: `same identity with changed payload transitions to conflict and failed`)
- **threshold absence**: Below-threshold events never call either observation repository. (Test: `below-threshold event remains absent`)
- **malformed absence**: A malformed-only snapshot creates no raw row and reports malformed. (Test: `malformed-only snapshot remains absent and returns malformed`)
- **partial durable progress**: Earlier valid event writes survive a later malformed event and the source reports partial. (Test: `valid event followed by malformed event preserves the valid write and returns partial`)
- **empty no-op**: An empty successful snapshot returns accepted with no persistence calls. (Test: `empty snapshot returns accepted with zero counts`)
- **stale retention**: A stale qualifying event is retained but reported degraded. (Test: `stale qualifying event is retained raw and normalized but returns degraded`)
- **defensible CEX absence**: Low-quality CEX attribution fails the pre-persistence quality gate. (Test: `CEX proxy below address-quality threshold remains absent`)
