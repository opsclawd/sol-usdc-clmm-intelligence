# Task Context: Task 4

Title: Wire Birdeye configuration and report Helius coverage unavailable

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

## Repository Targets

### Expected Files

- src/adapters/node/unavailable-on-chain-flow-source.ts
- scripts/collectors/on-chain-flow.ts
- tests/adapters/node/unavailable-on-chain-flow-source.test.ts
- tests/scripts/on-chain-flow.test.ts

### Reference Files

- src/jobs/on-chain-flow-job.ts

## Validation Commands

```bash
pnpm exec vitest run tests/adapters/node/unavailable-on-chain-flow-source.test.ts tests/scripts/on-chain-flow.test.ts -t "disabled Helius|provider configuration|configured values|missing Orca|PARTIAL|UNAVAILABLE|closes"
["pnpm","exec","eslint","src/adapters/node/unavailable-on-chain-flow-source.ts","scripts/collectors/on-chain-flow.ts","tests/adapters/node/unavailable-on-chain-flow-source.test.ts","tests/scripts/on-chain-flow.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **disabled Helius source**: The Helius placeholder always reports unavailable and performs no HTTP request. (Test: `always reports disabled Helius coverage as unavailable without HTTP`)
- **Birdeye config gate**: Missing Birdeye URL, key, or Orca pool aborts before persistence. (Test: `fails when the Orca pool address is missing`)
- **adapter option injection**: The script passes the parsed whale threshold and configured pool to the Birdeye adapter. (Test: `passes the pool and whale threshold to the Birdeye adapter`)
- **healthy Phase 1 status**: Usable Birdeye evidence plus unavailable Helius coverage reduces to PARTIAL and exits zero. (Test: `exits zero for PARTIAL status`)
- **no usable source status**: When Birdeye and Helius are both unavailable the command reports UNAVAILABLE and exits nonzero. (Test: `exits nonzero for UNAVAILABLE status`)
- **persistence lifecycle**: Once persistence opens it closes exactly once on success or failure. (Test: `closes the database connection exactly once on failure`)
