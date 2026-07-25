# Task Context: Task 1

Title: Define deterministic network status contracts and taxonomy

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-7
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-7
Start Commit: d9bb76998401dd5a7d8096b1d4f98db221c3ed23

## Task Requirements

**Files:**

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/normalized-network-status.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/taxonomy/validation.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the observation-kind parity list and a new `network_status registry` describe block)
- Modify: `tests/domain/taxonomy/validation.test.ts` (only the `runtime taxonomy parity` describe block)

**Behavioral invariants to test first:**

- `registers network status as deterministic execution safety evidence`
- `allows only solana rpc provenance for network status`
- `parses network status and solana rpc taxonomy literals`
- `requires warnings instead of nullable fabricated health values`

- [ ] **Step 1: Write the failing taxonomy and contract assertions**

  Extend the observation-kind parity fixture with `"network_status"`. Add a focused registry describe block that asserts deterministic `execution_safety`, a 60-second maximum age, 5-second skew tolerance, `staleBehavior: "exclude"`, schema version 1, and only `"solana-rpc"` provenance. In runtime parity, assert `parseObservationKind("network_status")` and `parseSource("solana-rpc")`.

  Use a compile-checked fixture with this exact public shape:

  ```ts
  const healthy: NetworkStatusPayloadV1 = {
    kind: "network_status",
    schemaVersion: 1,
    network: "solana-mainnet-beta",
    observedAtUnixMs: 1715342400000,
    health: "ok",
    slot: 260000000,
    slotsBehind: null,
    warnings: []
  };
  ```

  Run:

  ```bash
  pnpm test tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  ```

  Expected: FAIL because the new literals, payload contract, registry entry, and runtime validation entries do not exist.

- [ ] **Step 2: Add the exported payload and taxonomy literals**

  Add `"network_status"` to `ObservationKind` and `"solana-rpc"` to `Source`. Create and export:

  ```ts
  export type NetworkStatusWarning = "node_behind" | "slot_unavailable";

  export interface NetworkStatusPayloadV1 {
    readonly kind: "network_status";
    readonly schemaVersion: 1;
    readonly network: "solana-mainnet-beta";
    readonly observedAtUnixMs: number;
    readonly health: "ok" | "behind";
    readonly slot: number | null;
    readonly slotsBehind: number | null;
    readonly warnings: readonly NetworkStatusWarning[];
  }
  ```

  `health` is never nullable and never contains `"unknown"` or `"unavailable"`; absence stays in the source outcome rather than becoming fabricated evidence.

- [ ] **Step 3: Register and validate the new taxonomy values**

  Add the `network_status` registry entry beside the existing execution-safety kinds with deterministic weights `{ sourceReliability: 0.5, dataCompleteness: 0.3, derivationConfidence: 0.2, llmConfidence: 0 }`, standard thresholds, LLM redistribution enabled, and direct provenance restricted to `["solana-rpc"]`. Extend the literal arrays in `src/domain/taxonomy/validation.ts`.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 5: Commit**

  ```bash
  git add src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
  git commit -m "feat: define deterministic Solana network status evidence"
  ```

## Repository Targets

### Expected Files

- src/contracts/taxonomy.ts
- src/contracts/normalized-network-status.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- src/domain/taxonomy/validation.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/validation.test.ts

## Validation Commands

```bash
pnpm test tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
pnpm exec eslint src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/normalized-network-status.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/taxonomy/validation.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/validation.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **deterministic network status taxonomy**: network_status is deterministic execution-safety evidence with a short exclude-on-stale policy. (Test: `registers network status as deterministic execution safety evidence`)
- **restricted RPC provenance**: Only solana-rpc can directly source a network_status observation. (Test: `allows only solana rpc provenance for network status`)
- **runtime taxonomy parity**: Runtime parsers accept the same network_status and solana-rpc literals exposed by the TypeScript taxonomy. (Test: `parses network status and solana rpc taxonomy literals`)
- **no fabricated health**: Normalized status requires ok or behind health and represents missing availability as an outcome rather than a nullable or unknown value. (Test: `requires warnings instead of nullable fabricated health values`)
