# Task Context: Task 5

Title: Align operator configuration and routine documentation

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

## Repository Targets

### Expected Files

- .env.example
- cron/routines/on-chain-flow.md

### Reference Files

- README.md

## Validation Commands

```bash
sed -n '31,58p' .env.example
sed -n '1,90p' cron/routines/on-chain-flow.md
["pnpm","exec","prettier","--check",".env.example","cron/routines/on-chain-flow.md"]
```
