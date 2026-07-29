# Task Context: Task 2

Title: Replace the fictional source model with real pair-trade mapping

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-67
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-67
Start Commit: d29094d0cd501b0b730f2530c25d4acf38fd8c60

## Task Requirements

**Files:**

- Modify: `src/ports/on-chain-flow-source.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/domain/on-chain-flow/normalize.ts`
- Modify: `src/domain/on-chain-flow/threshold.ts`
- Modify: `src/adapters/node/http-birdeye-flow-source.ts`
- Modify: `tests/domain/on-chain-flow/normalize.test.ts`
- Modify: `tests/fixtures/on-chain-flow.ts`
- Create: `tests/fixtures/birdeye-pair-trades.json`
- Delete: `tests/adapters/node/http-birdeye-flow-source.test.ts`
- Create: `tests/adapters/node/http-birdeye-flow-source-mapping.test.ts`
- Reference: `src/adapters/node/http-helius-flow-source.ts`
- Reference: `src/application/collect-on-chain-flow.ts`
- Reference: `tests/fakes/fake-on-chain-flow-source.ts`

**Behavioral invariants:**

- `from.symbol === "SOL"` and `to.symbol === "USDC"` maps to outbound whale flow and contributes only to `sellVolumeUsdc`.
- `from.symbol === "USDC"` and `to.symbol === "SOL"` maps to inbound whale flow and contributes only to `buyVolumeUsdc`.
- Whale qualification is inclusive: USDC `uiAmount` equal to `whaleSwapMinUsdc` emits a whale; a smaller trade does not.
- Every valid response emits exactly one aggregate, including a zero-volume empty response; qualifying trades additionally emit one whale each.
- Aggregate arithmetic uses decimal-string/BigInt scale alignment so `buy - sell === net` exactly and never relies on binary floating-point subtraction.
- A whale uses `owner` as the wallet address, `txHash` as both source ID and transaction signature, `eventIndex: 0`, `stablecoinOperation: "transfer"`, and no slot.
- Unknown token direction, missing owner/hash/time, non-finite or negative USDC amount, `success !== true`, or malformed `data.items` fails the snapshot as `malformed`; it is never silently persisted as complete evidence.
- Duplicate `txHash` records are counted once and emit at most one whale event.

- [ ] **Step 1: Check in the verified provider fixture and write focused failing mapping tests**

  Add `tests/fixtures/birdeye-pair-trades.json` with the issue's real envelope and field names (`success`, `data.items`, `data.hasNext`, `txHash`, `owner`, `blockUnixTime`, and token-side objects). Use the verified SOL-to-USDC record from `issue.md`, retaining its exact hash, owner, timestamp, pool, token amounts, and `hasNext: true`. Add a second USDC-to-SOL record with `txHash: "inbound-fixture-tx"`, `owner: "InboundFixtureWallet"`, `blockUnixTime: 1785277900`, USDC `uiAmount: 750`, SOL `uiAmount: 10`, and `hasNext: false` only in tests that model the final page. Do not add an adapter-owned envelope.

  Replace the 600-line adapter test with `tests/adapters/node/http-birdeye-flow-source-mapping.test.ts`, limited to the mapping concerns in this task. Use these exact test names and assert the corresponding invariant listed above:
  - `maps the captured SOL-to-USDC trade to outbound whale and sell volume`
  - `maps USDC-to-SOL to inbound whale and buy volume`
  - `includes a trade exactly at WHALE_SWAP_MIN_USDC and excludes one below it`
  - `uses exact decimal arithmetic for the aggregate net flow`
  - `deduplicates repeated txHash records`
  - `returns a zero-volume aggregate for an empty successful page`
  - `rejects an item whose token sides are not SOL and USDC`

  Each test constructs:

  ```ts
  new HttpBirdeyeFlowSource({
    http,
    url: "https://public-api.birdeye.so",
    apiKey: "birdeye-secret",
    poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    whaleSwapMinUsdc: "500"
  });
  ```

- [ ] **Step 2: Run the mapping suite and confirm it fails against the fictional model**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-mapping.test.ts
  ```

  Expected: FAIL because the adapter does not accept pair-trades responses or the new options.

- [ ] **Step 3: Change the exported port event union and all directly coupled adapter declarations together**

  Replace `BirdeyeNetFlowEvent` with explicit canonical source-event shapes:

  ```ts
  export interface BirdeyeWhaleSwapEvent {
    readonly eventKind: "whale_swap";
    readonly sourceEventId: string;
    readonly observedAtUnixMs: number;
    readonly amountUsdc: string;
    readonly direction: "inbound" | "outbound";
    readonly venue: "solana";
    readonly addressContext: { readonly addressType: "wallet"; readonly address: string };
    readonly sourceReferences: readonly string[];
    readonly sourceQuality: {
      readonly provider: "birdeye-api";
      readonly freshness: "windowed";
      readonly completeness: "full";
    };
    readonly freshnessContext: { readonly blockTimestampUnixMs: number };
    readonly transactionSignature: string;
    readonly eventIndex: 0;
    readonly stablecoinOperation: "transfer";
  }

  export interface BirdeyeDexNetFlowEvent {
    readonly eventKind: "dex_net_flow";
    readonly sourceEventId: string;
    readonly observedAtUnixMs: number;
    readonly amountUsdc: string;
    readonly direction: "inbound" | "outbound";
    readonly venue: "solana";
    readonly addressContext: { readonly addressType: "contract"; readonly address: string };
    readonly sourceReferences: readonly string[];
    readonly sourceQuality: {
      readonly provider: "birdeye-api";
      readonly freshness: "windowed";
      readonly completeness: "full";
    };
    readonly freshnessContext: { readonly blockTimestampUnixMs: number };
    readonly windowStartUnixMs: number;
    readonly windowEndUnixMs: number;
    readonly buyVolumeUsdc: string;
    readonly sellVolumeUsdc: string;
    readonly netFlowUsdc: string;
  }
  ```

  Export both through `src/ports/index.ts`, and define `OnChainFlowSourceEvent` as the Helius event plus these two Birdeye events. Update `HttpBirdeyeFlowSourceOptions` in the same change to require `poolAddress` and `whaleSwapMinUsdc`; keep `collect(request)` unchanged so every existing port implementation still satisfies the interface. Inspect the Helius adapter, application cast, and fake adapter and leave them unchanged only if the automatic typecheck confirms structural compatibility.

- [ ] **Step 4: Implement one-page response validation and canonical mapping**

  Normalize the base URL with `new URL("/defi/txs/pair", options.url)`, send `X-API-KEY` and `x-chain: solana`, and build the initial request using:

  ```ts
  url.searchParams.set("address", options.poolAddress);
  url.searchParams.set("tx_type", "swap");
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "100");
  url.searchParams.set("after_time", String(Math.floor(request.fromUnixMs / 1000)));
  url.searchParams.set("before_time", String(Math.floor(request.toUnixMs / 1000)));
  ```

  Validate the provider envelope and every token side before mapping. Convert each `uiAmount` through `String(value)`, parse it into sign/digits/scale, align scales with zero padding, and use `BigInt` for threshold comparison and aggregate addition/subtraction. Format results without scientific notation and trim only redundant trailing fractional zeroes.

  Use these deterministic aggregate fields:

  ```ts
  {
    eventKind: "dex_net_flow",
    sourceEventId: `birdeye-pair:${poolAddress}:${request.fromUnixMs}:${request.toUnixMs}`,
    observedAtUnixMs: request.toUnixMs,
    amountUsdc: absoluteNetFlowUsdc,
    direction: netFlowIsNegative ? "outbound" : "inbound",
    venue: "solana",
    addressContext: { addressType: "contract", address: poolAddress },
    sourceReferences: [`${baseUrl}/defi/txs/pair`],
    sourceQuality: { provider: "birdeye-api", freshness: "windowed", completeness: "full" },
    freshnessContext: { blockTimestampUnixMs: request.toUnixMs },
    windowStartUnixMs: request.fromUnixMs,
    windowEndUnixMs: request.toUnixMs,
    buyVolumeUsdc,
    sellVolumeUsdc,
    netFlowUsdc
  }
  ```

  Return a frozen snapshot with provider ID `birdeye-pair-trades`, provider run ID derived from pool/window, `asOfUnixMs: request.toUnixMs`, license `Birdeye API`, and the aggregate plus qualifying whales. Adapt the old normalization arithmetic tests to direct `dex_net_flow` fixtures (the `birdeye_net_flow` branches were already removed in Task 1).

- [ ] **Step 5: Run focused mapping/domain tests and static checks**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-mapping.test.ts tests/domain/on-chain-flow/normalize.test.ts -t "Birdeye|DEX net flow|aggregate|whale|decimal|txHash"
  pnpm exec eslint src/ports/on-chain-flow-source.ts src/ports/index.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts src/adapters/node/http-birdeye-flow-source.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts
  ```

  Expected: selected tests PASS, ESLint exits 0, and the automatic workspace typecheck finds no port consumer left on `BirdeyeNetFlowEvent`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/ports/on-chain-flow-source.ts src/ports/index.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts src/adapters/node/http-birdeye-flow-source.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts tests/fixtures/birdeye-pair-trades.json tests/adapters/node/http-birdeye-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts
  git commit -m "feat: map real Birdeye pair trades to flow events"
  ```

## Repository Targets

### Expected Files

- src/ports/on-chain-flow-source.ts
- src/ports/index.ts
- src/domain/on-chain-flow/normalize.ts
- src/domain/on-chain-flow/threshold.ts
- src/adapters/node/http-birdeye-flow-source.ts
- tests/domain/on-chain-flow/normalize.test.ts
- tests/fixtures/on-chain-flow.ts
- tests/fixtures/birdeye-pair-trades.json
- tests/adapters/node/http-birdeye-flow-source.test.ts
- tests/adapters/node/http-birdeye-flow-source-mapping.test.ts

### Reference Files

- src/adapters/node/http-helius-flow-source.ts
- src/application/collect-on-chain-flow.ts
- tests/fakes/fake-on-chain-flow-source.ts

## Validation Commands

```bash
pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-mapping.test.ts tests/domain/on-chain-flow/normalize.test.ts -t "Birdeye|DEX net flow|aggregate|whale|decimal|txHash"
["pnpm","exec","eslint","src/ports/on-chain-flow-source.ts","src/ports/index.ts","src/domain/on-chain-flow/normalize.ts","src/domain/on-chain-flow/threshold.ts","src/adapters/node/http-birdeye-flow-source.ts","tests/domain/on-chain-flow/normalize.test.ts","tests/fixtures/on-chain-flow.ts","tests/adapters/node/http-birdeye-flow-source-mapping.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **SOL sale classification**: SOL-to-USDC maps to outbound whale direction and sell volume only. (Test: `maps the captured SOL-to-USDC trade to outbound whale and sell volume`)
- **SOL purchase classification**: USDC-to-SOL maps to inbound whale direction and buy volume only. (Test: `maps USDC-to-SOL to inbound whale and buy volume`)
- **inclusive whale threshold**: A trade equal to the configured whale threshold is included while a smaller trade is excluded. (Test: `includes a trade exactly at WHALE_SWAP_MIN_USDC and excludes one below it`)
- **exact aggregate arithmetic**: Decimal-scaled buy and sell sums produce an exact net value without floating-point drift. (Test: `uses exact decimal arithmetic for the aggregate net flow`)
- **transaction deduplication**: Repeated txHash records contribute once to aggregate volume and emit at most one whale. (Test: `deduplicates repeated txHash records`)
- **empty window aggregate**: An empty successful response emits one zero-volume aggregate and no whales. (Test: `returns a zero-volume aggregate for an empty successful page`)
- **unknown direction fails closed**: A trade that is not exactly SOL/USDC in either direction is rejected as malformed. (Test: `rejects an item whose token sides are not SOL and USDC`)
