# Task Context: Task 3

Title: Add the source port and both venue adapters

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

- Create: `src/ports/perp-liquidation-source.ts`
- Create: `src/adapters/node/http-binance-fapi-source.ts`
- Create: `src/adapters/node/http-drift-source.ts`
- Create: `tests/fakes/fake-perp-liquidation-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-binance-fapi-source.test.ts`
- Create: `tests/adapters/node/http-drift-source.test.ts`

- [ ] **Step 1: Write failing port/adapter tests**

  Name and cover:
  - `keeps venue response fields inside adapters and emits only canonical source facts`;
  - `retries retryable source failures and never retries malformed responses`;
  - `marks Binance liquidation coverage unavailable without calling a user-data endpoint`;
  - `maps Drift liquidation precision only from configured documented precision`;
  - malformed numeric strings, non-finite values, wrong market/symbol, HTTP 404/429/5xx, timeout, and secret-redacted diagnostics.

- [ ] **Step 2: Verify adapter tests fail**

  Run: `pnpm vitest run tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: FAIL because the port and adapters do not exist.

- [ ] **Step 3: Add the port and fake in the same task as every implementation**

  Define a single method so the interface and all implementations compile together:

  ```ts
  export interface PerpLiquidationSourceRequest {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }

  export interface PerpLiquidationSourceSnapshot {
    readonly source: "binance-fapi" | "drift-api";
    readonly providerRunId: string;
    readonly asOfUnixMs: number;
    readonly coverage: Readonly<Record<PerpMetricKind, PerpMetricCoverage>>;
    readonly facts: readonly PerpLiquidationSourceFact[];
  }

  export interface PerpLiquidationSourcePort {
    collect(request: PerpLiquidationSourceRequest): Promise<PerpLiquidationSourceSnapshot>;
  }
  ```

  `PerpLiquidationSourceFact` is a discriminated union with venue-neutral field names and decimal strings. `PerpLiquidationSourceError` has `timeout | network | unavailable | malformed`.

- [ ] **Step 4: Implement Binance public market-data collection**

  Use only documented public market-data paths under a configurable base URL:

  | Metric      | Binance path/behavior                                                        |
  | ----------- | ---------------------------------------------------------------------------- |
  | funding     | funding-rate history for the configured symbol                               |
  | OI          | open-interest statistics, 5-minute period, enough samples to span four hours |
  | basis       | mark/index price or documented basis response                                |
  | leverage    | global or top-trader long/short ratio, with methodology recorded             |
  | liquidation | no request; coverage is `unavailable` with a non-secret diagnostic           |

  Fetch independent metric endpoints concurrently, preserving per-metric coverage rather than rejecting the entire snapshot when one fails. Use bounded exponential backoff with injected `RetryControl`; retry only timeout/network/429/5xx. Never include headers, keys, signed query strings, or full response bodies in facts or diagnostics.

- [ ] **Step 5: Implement Drift public data collection**

  Accept a configurable base URL, SOL-PERP market index, endpoint paths, and documented integer precisions. Poll funding history, market state (OI plus mark/oracle values), and historical liquidation records for the request window. Emit a leverage proxy only when the response supplies a documented market net-position ratio; otherwise mark that metric unavailable. Reject rather than infer an undocumented precision or liquidation notional.

- [ ] **Step 6: Run focused tests and lint**

  Run: `pnpm vitest run tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/ports/perp-liquidation-source.ts src/adapters/node/http-binance-fapi-source.ts src/adapters/node/http-drift-source.ts tests/fakes/fake-perp-liquidation-source.ts tests/fakes/index.ts tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts`

  Expected: exit 0.

- [ ] **Step 7: Commit**

  ```bash
  git add src/ports/perp-liquidation-source.ts src/adapters/node/http-binance-fapi-source.ts src/adapters/node/http-drift-source.ts tests/fakes/fake-perp-liquidation-source.ts tests/fakes/index.ts tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts
  git commit -m "feat: add Binance and Drift perp source adapters"
  ```

## Repository Targets

### Expected Files

- src/ports/perp-liquidation-source.ts
- src/adapters/node/http-binance-fapi-source.ts
- src/adapters/node/http-drift-source.ts
- tests/fakes/fake-perp-liquidation-source.ts
- tests/fakes/index.ts
- tests/adapters/node/http-binance-fapi-source.test.ts
- tests/adapters/node/http-drift-source.test.ts

## Validation Commands

```bash
pnpm vitest run tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts
pnpm exec eslint src/ports/perp-liquidation-source.ts src/adapters/node/http-binance-fapi-source.ts src/adapters/node/http-drift-source.ts tests/fakes/fake-perp-liquidation-source.ts tests/fakes/index.ts tests/adapters/node/http-binance-fapi-source.test.ts tests/adapters/node/http-drift-source.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **venue response isolation**: Adapters translate venue payloads to canonical source facts so venue-specific fields never enter domain inputs. (Test: `keeps venue response fields inside adapters and emits only canonical source facts`)
- **bounded retry classification**: Timeout, network, 429, and 5xx failures retry within the configured bound while malformed and other non-retryable failures stop immediately. (Test: `retries retryable source failures and never retries malformed responses`)
- **Binance liquidation absence is explicit**: The Binance adapter never calls a user-data force-order endpoint and reports liquidation coverage unavailable rather than zero. (Test: `marks Binance liquidation coverage unavailable without calling a user-data endpoint`)
