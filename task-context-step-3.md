# Task Context: Task 3

Title: Validate, threshold, and normalize flow facts

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

- Create: `src/domain/on-chain-flow/validate.ts`
- Create: `src/domain/on-chain-flow/threshold.ts`
- Create: `src/domain/on-chain-flow/normalize.ts`
- Create: `src/domain/on-chain-flow/index.ts`
- Create: `tests/domain/on-chain-flow/validate.test.ts`
- Create: `tests/domain/on-chain-flow/threshold.test.ts`
- Create: `tests/domain/on-chain-flow/normalize.test.ts`

**Behavioral invariants to test first:**

- `accepts canonical factual events and rejects unknown or narrative fields`: strict schemas reject motive, recommendation, NaN, negative unsigned amounts, invalid time windows, and missing references.
- `includes an event when amount equals its configured threshold`: comparisons are exact decimal comparisons, not `Number` conversions.
- `filters an event when amount is below its kind threshold`: filtered events never reach raw persistence.
- `filters CEX proxy below attribution confidence even when amount qualifies`: both gates must pass.
- `normalizes transaction direction from explicit asset deltas only`: whale swap direction is `buy_sol`, `sell_sol`, or `unknown` based on supplied SOL/USDC deltas, never address intent.
- `normalizes stablecoin mint burn and transfer as separate operations`: operation is retained exactly.
- `normalizes DEX net flow with a signed net equal to buy minus sell`: inconsistent provider net values are rejected rather than silently corrected.
- `always attaches CEX proxy noise caveats and never upgrades it to deterministic`: address attribution remains probabilistic.

- [ ] **Step 1: Write failing pure-domain tests**

  Tests must name each invariant exactly and use boundary values such as `999999.99`, `1000000`, and `1000000.01`. Include a precision case beyond JavaScript’s safe integer range.

  Run:

  ```bash
  pnpm test tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  ```

  Expected: FAIL because the domain modules do not exist.

- [ ] **Step 2: Implement strict validation and exact decimal comparison**

  Implement:

  ```ts
  acceptOnChainFlowSourceEvent(input: unknown): AcceptedOnChainFlowSourceEvent
  parseOnChainFlowThresholds(input: OnChainFlowThresholds): ParsedOnChainFlowThresholds
  qualifiesOnChainFlow(event, thresholds): boolean
  normalizeOnChainFlow(event, retrievedAtUnixMs): OnChainFlowPayloadV1
  ```

  Parse decimals into sign, digits, and scale; compare aligned integer digits without floating point. Reject scientific notation, infinities, and non-canonical leading signs. Require CEX attribution confidence in `[0, 1]`.

- [ ] **Step 3: Implement factual normalization**

  Sort/deduplicate source references and address labels. Copy provider timestamps and venue/address facts. For DEX pressure, verify exact `buyVolumeUsdc - sellVolumeUsdc === netFlowUsdc`. Build `freshnessContext` from source observation and retrieval timestamps. Do not add interpretations.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  pnpm exec eslint src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
  git commit -m "feat: validate and normalize on-chain flow facts"
  ```

## Repository Targets

### Expected Files

- src/domain/on-chain-flow/validate.ts
- src/domain/on-chain-flow/threshold.ts
- src/domain/on-chain-flow/normalize.ts
- src/domain/on-chain-flow/index.ts
- tests/domain/on-chain-flow/validate.test.ts
- tests/domain/on-chain-flow/threshold.test.ts
- tests/domain/on-chain-flow/normalize.test.ts

## Validation Commands

```bash
pnpm test tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
pnpm exec eslint src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/on-chain-flow/validate.ts src/domain/on-chain-flow/threshold.ts src/domain/on-chain-flow/normalize.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/validate.test.ts tests/domain/on-chain-flow/threshold.test.ts tests/domain/on-chain-flow/normalize.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **strict factual schema**: Unknown narrative fields and invalid numeric/timestamp shapes are rejected. (Test: `accepts canonical factual events and rejects unknown or narrative fields`)
- **inclusive threshold**: An exact amount equal to its threshold qualifies. (Test: `includes an event when amount equals its configured threshold`)
- **below threshold filter**: An event below its kind threshold is filtered before raw persistence. (Test: `filters an event when amount is below its kind threshold`)
- **CEX attribution gate**: A CEX proxy must satisfy both amount and address-attribution confidence thresholds. (Test: `filters CEX proxy below attribution confidence even when amount qualifies`)
- **explicit swap direction**: Swap direction comes only from explicit SOL/USDC deltas. (Test: `normalizes transaction direction from explicit asset deltas only`)
- **stablecoin operation fidelity**: Mint, burn, and transfer operations remain distinct factual values. (Test: `normalizes stablecoin mint burn and transfer as separate operations`)
- **DEX arithmetic reconciliation**: Signed net flow must exactly equal buy volume minus sell volume. (Test: `normalizes DEX net flow with a signed net equal to buy minus sell`)
- **CEX probabilistic boundary**: Normalized CEX evidence always carries proxy caveats and remains probabilistic. (Test: `always attaches CEX proxy noise caveats and never upgrades it to deterministic`)
