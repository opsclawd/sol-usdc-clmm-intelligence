# Task Context: Task 1

Title: Define on-chain flow contracts and taxonomy entries

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

- Modify: `src/contracts/taxonomy.ts`
- Create: `src/contracts/on-chain-flow.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the `observationKinds` list and a new `on-chain flow registry` describe block)
- Modify: `tests/domain/taxonomy/confidence.test.ts` (only to cover the new `cex_proxy_quality_cap_applied` reason)
- Create: `tests/contracts/on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `registers deterministic on-chain transaction facts and probabilistic CEX proxies`: transfer, swap, stablecoin, and DEX entries use `on_chain_flow`; only `cex_flow_proxy` uses `probabilistic`.
- `allows only the source providers that can emit each flow kind`: Helius is allowed for transaction kinds and CEX proxy; Birdeye is allowed for DEX net flow.
- `requires explicit CEX proxy noise metadata`: the CEX payload schema cannot be represented without attribution confidence, attribution provider, proxy quality, and caveats.
- `does not provide a motive field on any normalized flow payload`: contract fixtures contain factual direction/context only.

- [ ] **Step 1: Write the failing contract and registry tests**

  Add exact tests named above. In `tests/contracts/on-chain-flow.test.ts`, use `satisfies OnChainFlowPayloadV1` fixtures and assert the discriminated union contains:
  - common fields: `schemaVersion`, `eventFamily`, `eventType`, `sourceEventId`, `observedAtUnixMs`, `amountUsdc`, `direction`, `venue`, `addressContext`, `sourceReferences`, `sourceQuality`, `freshnessContext`;
  - transaction identity: `transactionSignature`, `eventIndex`, `slot`;
  - stablecoin operation: `mint | burn | transfer`;
  - DEX window: `windowStartUnixMs`, `windowEndUnixMs`, `buyVolumeUsdc`, `sellVolumeUsdc`, `netFlowUsdc`;
  - CEX noise: `{ quality: "proxy"; attributionConfidence; attributionProvider; caveats }`.

  Run:

  ```bash
  pnpm test tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  ```

  Expected: FAIL because the new types, sources, kinds, and registry entries do not exist.

- [ ] **Step 2: Add the contracts and taxonomy**

  Extend `ObservationKind` with:

  ```ts
  | "whale_transfer"
  | "whale_swap"
  | "stablecoin_flow"
  | "dex_net_flow"
  | "cex_flow_proxy"
  ```

  Extend `Source` with `"helius-api" | "birdeye-api"` and `ConfidenceReason` with `"cex_proxy_quality_cap_applied"`.

  In `src/contracts/on-chain-flow.ts`, define `OnChainFlowDirection`, `OnChainAddressContext`, `OnChainFlowSourceQuality`, the five `*PayloadV1` interfaces, their `OnChainFlowPayloadV1` union, and:

  ```ts
  export interface OnChainFlowThresholds {
    readonly whaleTransferMinUsdc: string;
    readonly whaleSwapMinUsdc: string;
    readonly stablecoinFlowMinUsdc: string;
    readonly dexNetFlowMinUsdc: string;
    readonly cexFlowProxyMinUsdc: string;
    readonly cexMinAttributionConfidence: number;
  }
  ```

  Keep numeric money fields as canonical non-negative decimal strings, except signed `netFlowUsdc`. Do not add narrative, motive, recommendation, or policy fields. Export the file from `src/contracts/index.ts`.

- [ ] **Step 3: Register the five kinds**

  Add five version-1 entries to `observationKindRegistry`, all with `evidenceFamily: "on_chain_flow"`, 15-minute max age, 5-second skew tolerance, and `staleBehavior: "allow_context_only"`. Use `deterministic` for blockchain/window facts and `probabilistic` for `cex_flow_proxy`. Give CEX proxy greater weight to source reliability, and restrict provenance sources as described in the invariants.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  pnpm exec eslint src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts --max-warnings 0
  pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts
  git commit -m "feat: define on-chain flow evidence taxonomy"
  ```

## Repository Targets

### Expected Files

- src/contracts/taxonomy.ts
- src/contracts/on-chain-flow.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/taxonomy/confidence.test.ts
- tests/contracts/on-chain-flow.test.ts

## Validation Commands

```bash
pnpm test tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts
pnpm exec eslint src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts --max-warnings 0
pnpm exec prettier --check src/contracts/taxonomy.ts src/contracts/on-chain-flow.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/on-chain-flow.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/taxonomy/confidence.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **flow signal classes**: Transaction and DEX facts are deterministic, while CEX address-attribution proxies are probabilistic. (Test: `registers deterministic on-chain transaction facts and probabilistic CEX proxies`)
- **provider allowlists**: Helius is allowed for transaction/CEX kinds and Birdeye is allowed for DEX net flow. (Test: `allows only the source providers that can emit each flow kind`)
- **CEX noise shape**: Every CEX proxy carries attribution confidence/provider plus explicit proxy caveats. (Test: `requires explicit CEX proxy noise metadata`)
- **no motive contract**: Normalized flow payload contracts contain factual direction and context but no motive field. (Test: `does not provide a motive field on any normalized flow payload`)
