# Task Context: Task 2

Title: Validate normalize identify and enrich Solana RPC batches

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

- Create: `src/domain/network-status/solana-rpc.ts`
- Create: `src/domain/network-status/identity.ts`
- Create: `src/domain/network-status/normalize.ts`
- Create: `src/domain/network-status/enrich.ts`
- Create: `src/domain/network-status/index.ts`
- Create: `tests/fixtures/solana-network-status.ts`
- Create: `tests/domain/network-status/solana-rpc.test.ts`
- Create: `tests/domain/network-status/identity.test.ts`
- Create: `tests/domain/network-status/normalize.test.ts`
- Create: `tests/domain/network-status/enrich.test.ts`

**Behavioral invariants to test first:**

- `accepts healthy getHealth and getSlot responses regardless of batch order`
- `accepts Solana node-behind error minus 32005 as degraded health evidence`
- `rejects duplicate missing unknown or mismatched JSON-RPC response ids`
- `normalizes a healthy batch without warnings`
- `normalizes node-behind and missing slot as explicit sorted warnings`
- `derives stable identity from network and collection instant only`
- `enriches network status with fresh deterministic direct provenance`

- [ ] **Step 1: Add fixtures and failing strict-validation tests**

  Fixtures must cover: ordered and reversed healthy batches; health `-32005` with `{ numSlotsBehind: 12 }`; slot error; duplicate id; missing id; unknown id; wrong `jsonrpc`; unsafe/negative slot; unsafe/negative slots-behind; and arbitrary provider fields. Define the accepted domain shape:

  ```ts
  export interface AcceptedSolanaNetworkStatus {
    readonly health: "ok" | "behind";
    readonly slot: number | null;
    readonly slotsBehind: number | null;
    readonly slotUnavailable: boolean;
  }

  export function acceptSolanaNetworkStatusBatch(input: unknown): AcceptedSolanaNetworkStatus;
  ```

  Run:

  ```bash
  pnpm test tests/domain/network-status/solana-rpc.test.ts
  ```

  Expected: FAIL because the network-status domain does not exist.

- [ ] **Step 2: Implement strict id-correlated validation**

  Require an array containing exactly one `"health"` and one `"slot"` JSON-RPC 2.0 response. Accept only `"ok"` or error code `-32005` for health. Require safe non-negative integers for slot and `numSlotsBehind`. A slot error is allowed and represented as `slot: null`; a health error other than `-32005`, mixed result/error members, duplicates, missing ids, or unknown ids throws `SolanaNetworkStatusValidationError`.

- [ ] **Step 3: Write failing identity and normalization tests**

  Define:

  ```ts
  export function deriveSolanaNetworkStatusObservationKey(input: {
    readonly network: "solana-mainnet-beta";
    readonly observedAtUnixMs: number;
  }): Promise<string>;

  export function normalizeSolanaNetworkStatus(input: {
    readonly accepted: AcceptedSolanaNetworkStatus;
    readonly observedAtUnixMs: number;
  }): NetworkStatusPayloadV1;
  ```

  Assert response ordering and provider-only extra fields do not affect identity. Assert warnings are sorted and deduplicated, healthy status has no warnings, `behind` always has `node_behind`, and a missing slot always has `slot_unavailable`.

  Run:

  ```bash
  pnpm test tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts
  ```

  Expected: FAIL because identity and normalization are not implemented.

- [ ] **Step 4: Implement identity normalization and deterministic enrichment**

  Hash `{ identityVersion: 1, network, observedAtUnixMs }` with `canonicalHash`. Normalize only accepted facts. Implement enrichment using `getObservationKindEntry("network_status")`, `computeFreshness`, `computeConfidence`, `validateProvenance`, and `canonicalizePayload`, following `src/domain/pool-statistics/enrich.ts`. Use direct raw provenance from `"solana-rpc"`, collector `"collect-solana-network-status"`, job name `"core-collection-job"`, source reliability `0.95`, completeness `1` with slot or `0.7` without it, derivation confidence `1`, and no LLM confidence.

  The enrichment test must assert `signalClass: "deterministic"`, `evidenceFamily: "execution_safety"`, one raw/source ref, the supplied run/code versions, and freshness based on the collection instant.

  Export the concrete enrichment result as `EnrichedNetworkStatusObservation` and keep the callable signature consistent across the domain barrel and collector:

  ```ts
  export function enrichNetworkStatus(input: {
    readonly rawObservationId: number;
    readonly sourceObservationKey: string;
    readonly rawPayloadHash: string;
    readonly observedAtUnixMs: number;
    readonly fetchedAtUnixMs: number;
    readonly receivedAtUnixMs: number;
    readonly payload: NetworkStatusPayloadV1;
    readonly nowMs: number;
    readonly codeVersion: string;
    readonly runId: string | null;
  }): Promise<EnrichedNetworkStatusObservation>;
  ```

- [ ] **Step 5: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
  pnpm exec eslint src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 6: Commit**

  ```bash
  git add src/domain/network-status tests/fixtures/solana-network-status.ts tests/domain/network-status
  git commit -m "feat: normalize Solana RPC health observations"
  ```

## Repository Targets

### Expected Files

- src/domain/network-status/solana-rpc.ts
- src/domain/network-status/identity.ts
- src/domain/network-status/normalize.ts
- src/domain/network-status/enrich.ts
- src/domain/network-status/index.ts
- tests/fixtures/solana-network-status.ts
- tests/domain/network-status/solana-rpc.test.ts
- tests/domain/network-status/identity.test.ts
- tests/domain/network-status/normalize.test.ts
- tests/domain/network-status/enrich.test.ts

## Validation Commands

```bash
pnpm test tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
pnpm exec eslint src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/network-status/solana-rpc.ts src/domain/network-status/identity.ts src/domain/network-status/normalize.ts src/domain/network-status/enrich.ts src/domain/network-status/index.ts tests/fixtures/solana-network-status.ts tests/domain/network-status/solana-rpc.test.ts tests/domain/network-status/identity.test.ts tests/domain/network-status/normalize.test.ts tests/domain/network-status/enrich.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **batch order independence**: JSON-RPC ids, not response array positions, determine health and slot meaning. (Test: `accepts healthy getHealth and getSlot responses regardless of batch order`)
- **recognized behind state**: Error -32005 with a valid numSlotsBehind is accepted as degraded factual health. (Test: `accepts Solana node-behind error minus 32005 as degraded health evidence`)
- **unambiguous response ids**: Duplicate, missing, unknown, or malformed JSON-RPC ids are rejected before normalization. (Test: `rejects duplicate missing unknown or mismatched JSON-RPC response ids`)
- **healthy normalization**: A healthy response retains the slot and emits no warnings. (Test: `normalizes a healthy batch without warnings`)
- **degraded warning normalization**: Behind health and unavailable slot produce explicit sorted warnings without fabricated facts. (Test: `normalizes node-behind and missing slot as explicit sorted warnings`)
- **stable observation identity**: Only network and collection instant affect identity; response member order does not. (Test: `derives stable identity from network and collection instant only`)
- **direct deterministic enrichment**: Network status receives deterministic execution-safety classification with fresh direct raw provenance. (Test: `enriches network status with fresh deterministic direct provenance`)
