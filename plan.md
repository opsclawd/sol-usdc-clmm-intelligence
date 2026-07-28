<!-- plan-review-required -->

# Birdeye Pair-Trades On-Chain Flow Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fictional Birdeye flow feed with bounded, paginated reads of the real Birdeye `/defi/txs/pair` endpoint that emit auditable `whale_swap` and aggregated `dex_net_flow` events, while reporting the three Helius-dependent event kinds as unavailable.

**Architecture:** Keep the collector/application pipeline unchanged: the Node adapter converts provider records into canonical on-chain-flow source events, and the existing application layer validates, thresholds, normalizes, and persists them. Make slot absence explicit in the contract, use the configured Orca pool and whale threshold at the adapter boundary, retain bounded page-level retries, and provide a disabled source adapter so the job's two-source result remains `PARTIAL` when Birdeye succeeds.

**Tech Stack:** TypeScript, Node URL handling, Zod, Vitest, pnpm, existing `HttpClient`/`RetryControl` ports.

---

**Goal details**

- Request the verified Birdeye pair-trades endpoint with `address`, `tx_type=swap`, `offset`, `limit`, `after_time`, and `before_time`.
- Convert SOL-to-USDC trades to outbound/sell flow and USDC-to-SOL trades to inbound/buy flow.
- Emit one `whale_swap` per qualifying trade and one exact-arithmetic `dex_net_flow` aggregate per requested window.
- Preserve provenance with Solscan transaction URLs and the configured pool address; never synthesize a slot.
- Keep the job's existing persistence, replay, threshold, and status reduction behavior.

**Non-goals**

- Do not implement Helius collection for `whale_transfer`, `stablecoin_flow`, or `cex_flow_proxy`.
- Do not add wallet watch lists, attribution heuristics, Solana RPC slot lookups, transactions, policy synthesis, migrations, or new dependencies.
- Do not change the regime-engine evidence contract or the job's two-source status truth table.
- Do not live-call Birdeye from automated tests; use the checked-in response fixture.

**Affected files**

- `src/contracts/on-chain-flow.ts`
- `src/domain/on-chain-flow/validate.ts`
- `src/domain/on-chain-flow/normalize.ts`
- `src/domain/on-chain-flow/threshold.ts`
- `src/ports/on-chain-flow-source.ts`
- `src/ports/index.ts`
- `src/adapters/node/http-birdeye-flow-source.ts`
- `src/adapters/node/unavailable-on-chain-flow-source.ts` (new)
- `scripts/collectors/on-chain-flow.ts`
- `tests/contracts/on-chain-flow.test.ts`
- `tests/domain/on-chain-flow/validate.test.ts`
- `tests/domain/on-chain-flow/normalize.test.ts`
- `tests/fixtures/on-chain-flow.ts`
- `tests/fixtures/birdeye-pair-trades.json` (new)
- `tests/adapters/node/http-birdeye-flow-source.test.ts` (remove and replace with the two focused files below)
- `tests/adapters/node/http-birdeye-flow-source-mapping.test.ts` (new)
- `tests/adapters/node/http-birdeye-flow-source-pagination.test.ts` (new)
- `tests/adapters/node/unavailable-on-chain-flow-source.test.ts` (new)
- `tests/scripts/on-chain-flow.test.ts`
- `.env.example`
- `cron/routines/on-chain-flow.md`

## Task 1: Make slot absence explicit in canonical flow contracts

**Files:**

- Modify: `src/contracts/on-chain-flow.ts`
- Modify: `src/domain/on-chain-flow/validate.ts`
- Modify: `src/domain/on-chain-flow/normalize.ts`
- Modify: `src/domain/on-chain-flow/threshold.ts`
- Modify: `tests/contracts/on-chain-flow.test.ts`
- Modify: `tests/domain/on-chain-flow/validate.test.ts`
- Modify: `tests/domain/on-chain-flow/normalize.test.ts`
- Modify: `tests/fixtures/on-chain-flow.ts`
- Reference: `src/ports/on-chain-flow-source.ts`

**Behavioral invariants:**

- A Birdeye `whale_swap` with a real `blockTimestampUnixMs` and no slot is valid.
- A Birdeye `dex_net_flow` with a real `blockTimestampUnixMs` and no slot is valid.
- A provided slot must still be a non-negative integer; negative and fractional slots remain invalid.
- Helius transaction input still requires its real top-level slot, and the Helius-derived normalized payload still carries it.
- Omitting slot never causes a placeholder such as `0` to appear in accepted or normalized data.

- [ ] **Step 1: Write the failing contract and validation cases first**

  In the existing `WhaleSwapPayloadV1` contract case, construct a Birdeye payload without top-level `slot` and with:

  ```ts
  freshnessContext: {
    blockTimestampUnixMs: 1700000000000;
  }
  ```

  In the canonical validation describe block, add these exact cases:

  ```ts
  it("accepts Birdeye whale_swap without a fabricated slot", () => {
    const result = acceptOnChainFlowSourceEvent(makeBirdeyeWhaleSwapEvent());
    expect(result).not.toHaveProperty("slot");
    expect(result.freshnessContext).not.toHaveProperty("slot");
  });

  it("accepts Birdeye dex_net_flow without a fabricated slot", () => {
    const result = acceptOnChainFlowSourceEvent(makeBirdeyeDexNetFlowEvent());
    expect(result).not.toHaveProperty("slot");
    expect(result.freshnessContext).not.toHaveProperty("slot");
  });

  it("rejects a provided negative freshness slot", () => {
    expect(() =>
      acceptOnChainFlowSourceEvent(
        makeBirdeyeWhaleSwapEvent({
          freshnessContext: { slot: -1, blockTimestampUnixMs: 1700000000000 }
        })
      )
    ).toThrow("[freshnessContext.slot]");
  });
  ```

  Replace the fictional fixture event with `makeBirdeyeWhaleSwapEvent()` and `makeBirdeyeDexNetFlowEvent()` factories whose defaults use provider `birdeye-api`, omit slot, use valid Solscan/Birdeye URLs, and match the canonical schemas.

- [ ] **Step 2: Run the focused cases and confirm they fail for the slot requirement**

  Run:

  ```bash
  pnpm exec vitest run tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts -t "slot|Birdeye whale_swap|Birdeye dex_net_flow"
  ```

  Expected: FAIL because `OnChainFlowFreshnessContext.slot` and the whale-swap schema's top-level slot are required.

- [ ] **Step 3: Relax only the Birdeye-compatible slot surfaces**

  Change the shared freshness context and whale-swap payload declaration to:

  ```ts
  export type OnChainFlowFreshnessContext = {
    readonly slot?: number;
    readonly blockTimestampUnixMs: number;
  };

  export type WhaleSwapPayloadV1 = {
    readonly schemaVersion: 1;
    readonly eventFamily: "on_chain_flow";
    readonly eventType: "whale_swap";
    readonly sourceEventId: string;
    readonly observedAtUnixMs: number;
    readonly amountUsdc: string;
    readonly direction: OnChainFlowDirection;
    readonly venue: "solana";
    readonly addressContext: OnChainAddressContext;
    readonly sourceReferences: readonly string[];
    readonly sourceQuality: OnChainFlowSourceQuality;
    readonly freshnessContext: OnChainFlowFreshnessContext;
    readonly transactionSignature: string;
    readonly eventIndex: number;
    readonly slot?: number;
    readonly stablecoinOperation: StablecoinOperation;
  };
  ```

  Make `freshnessContextSchema.slot` and `whaleSwapFlowSchema.slot` optional. Leave the Helius transaction schema and the Helius-only/top-level slot requirements for other event kinds unchanged. Remove `birdeyeNetFlowSchema` from the accepted union and replace its validation fixture coverage with canonical `whale_swap`/`dex_net_flow` coverage. Also remove the `birdeye_net_flow` branches from `normalize.ts` and `threshold.ts` and update `normalize.test.ts` to remove `birdeye_net_flow` fixture coverage in the same task — this avoids a typecheck failure caused by referencing an event kind removed from the union before the branch removals are applied.

- [ ] **Step 4: Run focused validation and static checks**

  Run:

  ```bash
  pnpm exec vitest run tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts -t "slot|Birdeye whale_swap|Birdeye dex_net_flow|valid Helius"
  pnpm exec eslint src/contracts/on-chain-flow.ts src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts
  ```

  Expected: selected tests PASS and ESLint exits 0. The implementation loop's automatic `pnpm -r typecheck` gate must also pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/contracts/on-chain-flow.ts src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts
  git commit -m "fix: represent Birdeye flow events without slots"
  ```

## Task 2: Replace the fictional source model with real pair-trade mapping

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

## Task 3: Add bounded pagination and page-level recovery

**Files:**

- Modify: `src/adapters/node/http-birdeye-flow-source.ts`
- Create: `tests/adapters/node/http-birdeye-flow-source-pagination.test.ts`
- Reference: `src/ports/http.ts`
- Reference: `src/ports/retry.ts`
- Reference: `tests/fakes/fake-retry.ts`

**Behavioral invariants:**

- Starting at offset 0, `hasNext: true` transitions to the next offset by the fixed page limit; `hasNext: false` transitions to complete.
- Trades from all completed pages contribute once to the final aggregate and whale list.
- A retryable failure transitions the current page from attempt N to attempt N+1 without refetching or recounting completed pages.
- A non-retryable malformed/4xx failure transitions directly to the mapped error with no sleep.
- Timeout, 429, and 5xx failures retry only up to `maxAttempts`; exhaustion maps to timeout/unavailable as appropriate.
- API keys are redacted from every thrown diagnostic.
- `hasNext: true` at the 100-page safety bound aborts as `unavailable`; it never publishes a `completeness: "full"` partial aggregate.
- An empty page with `hasNext: true` still advances by the fixed limit and cannot stall the loop.

- [ ] **Step 1: Write the focused pagination/recovery cases first**

  Create a test file with no more than ten cases and these exact names:
  - `paginates offsets until hasNext is false and aggregates every page once`
  - `advances past an empty page whose hasNext is true`
  - `retries only the failed page without refetching completed pages`
  - `retries timeout 429 and 5xx responses up to maxAttempts`
  - `does not retry malformed JSON or non-retryable 4xx responses`
  - `redacts the Birdeye API key from exhausted retry diagnostics`
  - `fails unavailable instead of publishing a partial aggregate at the page cap`
  - `sends the pair address window swap type limit and Solana headers on every page`

  Assert exact URL query values and exact `FakeRetry.sleepCalls`, not merely call counts.

- [ ] **Step 2: Run the pagination suite and confirm the single-page adapter fails**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-pagination.test.ts
  ```

  Expected: FAIL on second-page requests and page-local retry behavior.

- [ ] **Step 3: Implement the bounded page state machine**

  Introduce these constants and a private `fetchPageWithRetry(offset, request)` method returning `Promise<BirdeyePairTradesPage>`:

  ```ts
  const PAGE_LIMIT = 100;
  const MAX_PAGES = 100;
  ```

  The method must build the URL for the supplied offset, call `getJson` with `maxAttempts: 1`, classify abort/HTTP/JSON/network failures exactly once per attempt, sleep with the existing capped exponential backoff only when retryable and attempts remain, and throw `mapToOnChainFlowSourceError(error, apiKey)` on exhaustion.

  The concrete loop is:

  ```ts
  const trades: BirdeyePairTrade[] = [];
  for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE_LIMIT) {
    const response = await fetchPageWithRetry(offset, request);
    trades.push(...response.items);
    if (!response.hasNext) {
      return buildSnapshot(deduplicateByTxHash(trades), request);
    }
  }
  throw {
    kind: "unavailable",
    diagnostic: `Birdeye pagination exceeded ${MAX_PAGES} pages`
  } satisfies OnChainFlowSourceError;
  ```

  Keep accumulators local to `buildSnapshot` so retries cannot double count. Preserve the existing error mapping semantics: 404/429/5xx are unavailable after retries, aborts are timeout, invalid JSON is malformed, and other failures are network.

- [ ] **Step 4: Run focused pagination/mapping tests and static checks**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-pagination.test.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts
  pnpm exec eslint src/adapters/node/http-birdeye-flow-source.ts tests/adapters/node/http-birdeye-flow-source-pagination.test.ts
  ```

  Expected: both focused adapter suites PASS and ESLint exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/adapters/node/http-birdeye-flow-source.ts tests/adapters/node/http-birdeye-flow-source-pagination.test.ts
  git commit -m "feat: paginate Birdeye pair trades safely"
  ```

## Task 4: Wire Birdeye configuration and report Helius coverage unavailable

**Files:**

- Create: `src/adapters/node/unavailable-on-chain-flow-source.ts`
- Modify: `scripts/collectors/on-chain-flow.ts`
- Create: `tests/adapters/node/unavailable-on-chain-flow-source.test.ts`
- Modify: `tests/scripts/on-chain-flow.test.ts`
- Reference: `src/jobs/on-chain-flow-job.ts`

**Behavioral invariants:**

- The disabled Helius source always returns an `unavailable` source error with a non-secret diagnostic and performs no HTTP call.
- Missing Birdeye URL, API key, or Orca pool address aborts before persistence opens.
- Valid configuration passes the parsed `ON_CHAIN_WHALE_SWAP_MIN_USDC` and `ORCA_SOL_USDC_WHIRLPOOL` values into `HttpBirdeyeFlowSource`.
- Helius URL/key are neither required nor read for Phase 1.
- Birdeye usable plus Helius unavailable reduces through the unchanged job truth table to `PARTIAL` with exit code 0.
- Birdeye unavailable plus Helius unavailable remains `UNAVAILABLE` with exit code 1.
- Persistence closes exactly once after a started run, including failures.

- [ ] **Step 1: Write disabled-source and script wiring tests first**

  Add:

  ```ts
  it("always reports disabled Helius coverage as unavailable without HTTP", async () => {
    const source = new UnavailableOnChainFlowSource(
      "Helius flow kinds are not implemented in Phase 1"
    );
    await expect(source.collect({ pair: "SOL/USDC", fromUnixMs: 1, toUnixMs: 2 })).rejects.toEqual({
      kind: "unavailable",
      diagnostic: "Helius flow kinds are not implemented in Phase 1"
    });
  });
  ```

  In `tests/scripts/on-chain-flow.test.ts`, update only the provider-configuration and adapter-construction describe blocks. Remove the expectations that Helius environment variables are mandatory, add a missing-pool case, and assert:

  ```ts
  expect(HttpBirdeyeFlowSource).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "https://public-api.birdeye.so",
      poolAddress: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      whaleSwapMinUsdc: "1000000"
    })
  );
  expect(runOnChainFlowJob).toHaveBeenCalledWith(
    expect.objectContaining({
      sources: [
        expect.objectContaining({ source: "helius-api" }),
        expect.objectContaining({ source: "birdeye-api" })
      ]
    })
  );
  ```

- [ ] **Step 2: Run only the changed script sections and disabled-source test**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts -t "disabled Helius|provider configuration|configured values|missing Orca|PARTIAL|UNAVAILABLE"
  ```

  Expected: FAIL because the script still requires and instantiates the Helius HTTP adapter and does not pass pool/threshold options to Birdeye.

- [ ] **Step 3: Add the unavailable adapter and rewire the entrypoint**

  Implement:

  ```ts
  export class UnavailableOnChainFlowSource implements OnChainFlowSourcePort {
    constructor(private readonly diagnostic: string) {}

    async collect(_request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot> {
      throw { kind: "unavailable", diagnostic: this.diagnostic } satisfies OnChainFlowSourceError;
    }
  }
  ```

  In the script, stop reading `HELIUS_FLOW_API_URL` and `HELIUS_API_KEY`, require `ORCA_SOL_USDC_WHIRLPOOL`, parse thresholds before constructing sources, and construct:

  ```ts
  const heliusSource = new UnavailableOnChainFlowSource(
    "Helius flow kinds are not implemented in Phase 1"
  );

  const birdeyeSource = new HttpBirdeyeFlowSource({
    http: runtime.http,
    url: birdeyeUrl,
    apiKey: birdeyeApiKey,
    poolAddress: orcaPoolAddress,
    whaleSwapMinUsdc: thresholds.whaleSwapMinUsdc,
    retryControl: runtime.retryControl
  });
  ```

  Preserve the two configured source keys, persistence lifecycle, secret-redacting output, and existing exit-code logic.

- [ ] **Step 4: Run the changed script sections, adapter test, and static checks**

  Run:

  ```bash
  pnpm exec vitest run tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts -t "disabled Helius|provider configuration|configured values|missing Orca|PARTIAL|UNAVAILABLE|closes"
  pnpm exec eslint src/adapters/node/unavailable-on-chain-flow-source.ts scripts/collectors/on-chain-flow.ts tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts
  ```

  Expected: selected tests PASS, no Helius HTTP constructor is called, and ESLint exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/adapters/node/unavailable-on-chain-flow-source.ts scripts/collectors/on-chain-flow.ts tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts
  git commit -m "feat: disable unavailable Helius flow coverage"
  ```

## Task 5: Align operator configuration and routine documentation

**Files:**

- Modify: `.env.example`
- Modify: `cron/routines/on-chain-flow.md`
- Reference: `README.md`

- [ ] **Step 1: Update the example configuration**

  Set:

  ```dotenv
  # On-chain flow Phase 1: Birdeye pair trades; Helius-derived kinds remain unavailable.
  BIRDEYE_FLOW_API_URL=https://public-api.birdeye.so
  BIRDEYE_API_KEY=
  ON_CHAIN_WHALE_SWAP_MIN_USDC=1000000
  ON_CHAIN_DEX_NET_FLOW_MIN_USDC=5000000
  ON_CHAIN_FLOW_LOOKBACK_MS=900000
  ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
  ```

  Remove `HELIUS_FLOW_API_URL` and `HELIUS_API_KEY` from this example block because repository search shows no other collector consumes them. The routine documentation will identify Helius settings as future work rather than active configuration.

- [ ] **Step 2: Correct the routine's source and event matrix**

  Document `/defi/txs/pair`, the required Birdeye key/pool/window settings, and this exact coverage:

  | Event kind        | Phase 1 status | Source                      |
  | ----------------- | -------------- | --------------------------- |
  | `whale_swap`      | Live           | Birdeye pair trades         |
  | `dex_net_flow`    | Live           | Birdeye pair trades         |
  | `whale_transfer`  | Unavailable    | Helius follow-up            |
  | `stablecoin_flow` | Unavailable    | Helius follow-up            |
  | `cex_flow_proxy`  | Unavailable    | Helius/watch-list follow-up |

  Explain that a healthy Phase 1 run is normally `PARTIAL` because Birdeye provides usable evidence while the disabled Helius source reports unavailable. Keep the no-policy/no-execution and missing-coverage warnings.

- [ ] **Step 3: Validate only the edited configuration/document sections**

  Run:

  ```bash
  sed -n '31,58p' .env.example
  sed -n '1,90p' cron/routines/on-chain-flow.md
  pnpm exec prettier --check .env.example cron/routines/on-chain-flow.md
  ```

  Expected: the displayed sections name the public Birdeye base URL, pool, two live kinds, three unavailable kinds, and `PARTIAL` healthy status; Prettier exits 0.

- [ ] **Step 4: Commit**

  ```bash
  git add .env.example cron/routines/on-chain-flow.md
  git commit -m "docs: describe Birdeye on-chain flow phase 1"
  ```

**Tests to add or update**

- Contract/type checks for optional slot only on Birdeye-compatible `whale_swap` and freshness context.
- Zod acceptance/rejection cases for missing, valid, and invalid slot values.
- Captured-shape mapping tests for direction, threshold boundary, owner/signature provenance, exact aggregate arithmetic, empty windows, duplicates, and malformed trades.
- Pagination state tests for offsets, page termination, empty pages, page-local retries, error mapping/redaction, and the page cap.
- Disabled-source and script tests for Helius unavailability, Birdeye config injection, status/exit behavior, and persistence cleanup.
- Existing direct DEX normalization tests migrated away from the fictional `birdeye_net_flow` event.

**Dedicated validate-phase commands**

Run these after all implementation tasks; they are not a standalone implementation task:

```bash
pnpm exec vitest run tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/normalize.test.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts tests/adapters/node/http-birdeye-flow-source-pagination.test.ts tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts
pnpm typecheck
pnpm boundaries
pnpm exec eslint src/contracts/on-chain-flow.ts src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-birdeye-flow-source.ts src/adapters/node/unavailable-on-chain-flow-source.ts scripts/collectors/on-chain-flow.ts tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts tests/adapters/node/http-birdeye-flow-source-pagination.test.ts tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts
pnpm exec prettier --check src/contracts/on-chain-flow.ts src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/threshold.ts src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-birdeye-flow-source.ts src/adapters/node/unavailable-on-chain-flow-source.ts scripts/collectors/on-chain-flow.ts tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/normalize.test.ts tests/fixtures/on-chain-flow.ts tests/fixtures/birdeye-pair-trades.json tests/adapters/node/http-birdeye-flow-source-mapping.test.ts tests/adapters/node/http-birdeye-flow-source-pagination.test.ts tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts .env.example cron/routines/on-chain-flow.md
```

With deployment credentials and database configuration supplied through the normal environment, perform the acceptance smoke test:

```bash
pnpm collect:on-chain-flow
```

Expected: the command exits 0 with overall `PARTIAL`; the Birdeye outcome is usable and contains persisted real `dex_net_flow` plus any threshold-qualifying `whale_swap` observations, while the Helius outcome is `unavailable`. If the live window contains no qualifying whale, verify the aggregate and the explicit zero whale count rather than lowering the production threshold.

**Risk areas**

- Provider payload drift, token symbol casing, or an undocumented pagination contract could turn a nominally successful response into incomplete evidence; strict parsing and the page cap intentionally fail closed.
- `uiAmount` arrives as a JSON number. Decimal conversion must reject scientific/non-finite values and use exact scaled arithmetic after conversion; binary floating-point aggregation would violate the DEX net invariant.
- Retry scope matters: retrying the whole collection after completed pages could duplicate aggregate volume.
- Consecutive windows use millisecond inputs converted to Unix seconds. The implementation must consistently use the requested bounds and deterministic IDs to avoid overlap/replay surprises.
- Making freshness slot optional widens a shared exported contract. Helius paths must retain their real slot requirements, and every consumer must pass the automatic workspace typecheck.
- The live smoke test writes raw and normalized observations to the configured intelligence database. Run it only against the intended deployment target.

**Stop conditions**

- Abort if the checked live fixture or current provider response does not contain the documented `success/data/items/hasNext` shape, or if `after_time`/`before_time`/offset semantics cannot be verified.
- Abort rather than publish partial evidence if pagination reaches the cap, repeats without progress, or provider records cannot be uniquely deduplicated by `txHash`.
- Abort if SOL/USDC direction cannot be determined from the returned token sides, a required owner/hash/timestamp is absent, or USDC volume cannot be represented without scientific notation or precision loss.
- Abort if a downstream contract demonstrably requires a real slot; do not restore `slot: 0` or add per-trade RPC calls without a revised design.
- Abort if implementation requires enabling Helius, adding a wallet watch list, changing DB schema, or modifying regime-engine policy/evidence contracts; those are outside this plan.
- Abort the live smoke test before persistence if the target database, Birdeye key, or Orca pool address is missing or points at an unintended environment.
