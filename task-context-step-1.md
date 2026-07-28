# Task Context: Task 1

Title: Make slot absence explicit in canonical flow contracts

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

## Repository Targets

### Expected Files

- src/contracts/on-chain-flow.ts
- src/domain/on-chain-flow/validate.ts
- tests/contracts/on-chain-flow.test.ts
- tests/domain/on-chain-flow/validate.test.ts
- tests/fixtures/on-chain-flow.ts

### Reference Files

- src/domain/on-chain-flow/normalize.ts

## Validation Commands

```bash
pnpm exec vitest run tests/contracts/on-chain-flow.test.ts tests/domain/on-chain-flow/validate.test.ts -t "slot|Birdeye whale_swap|Birdeye dex_net_flow|valid Helius"
["pnpm","exec","eslint","src/contracts/on-chain-flow.ts","src/domain/on-chain-flow/validate.ts","tests/contracts/on-chain-flow.test.ts","tests/domain/on-chain-flow/validate.test.ts","tests/fixtures/on-chain-flow.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **slotless Birdeye whale swap**: A Birdeye whale_swap with an authoritative block timestamp and no slot is accepted without adding a placeholder slot. (Test: `accepts Birdeye whale_swap without a fabricated slot`)
- **slotless Birdeye aggregate**: A Birdeye dex_net_flow with an authoritative block timestamp and no slot is accepted without adding a placeholder slot. (Test: `accepts Birdeye dex_net_flow without a fabricated slot`)
- **provided slot remains validated**: When a slot is supplied it must remain a non-negative integer. (Test: `rejects a provided negative freshness slot`)
- **Helius slot remains required**: Helius transaction input continues to require and preserve its real slot. (Test: `accepts valid Helius transaction flow event`)
