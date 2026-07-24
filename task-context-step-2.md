# Task Context: Task 2

Title: Add source port, Helius adapter, and Birdeye adapter

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

- Create: `src/ports/on-chain-flow-source.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/http-helius-flow-source.ts`
- Create: `src/adapters/node/http-birdeye-flow-source.ts`
- Create: `tests/fakes/fake-on-chain-flow-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-helius-flow-source.test.ts`
- Create: `tests/adapters/node/http-birdeye-flow-source.test.ts`
- Create: `tests/fixtures/on-chain-flow.ts`

**Port/interface atomicity:** This task adds `OnChainFlowSourcePort.collect` and, in the same task, adds every known implementation: `HttpHeliusFlowSource`, `HttpBirdeyeFlowSource`, and `FakeOnChainFlowSource`. Do not merge the port without all three implementations.

**Behavioral invariants to test first:**

- `Helius adapter maps transaction facts without adding motive`: accepted fields are copied into bounded source events; no narrative direction is inferred.
- `Birdeye adapter maps buy sell volumes and signed net flow for the requested window`: the request always targets `SOL/USDC`.
- `adapter rejects a malformed source envelope before application persistence`: missing stable identity, timestamps, source references, or non-finite attribution quality produces `{ kind: "malformed" }`.
- `adapter retries retryable failures up to maxAttempts`: timeout, 429, and 5xx retry with injected `RetryControl`; invalid JSON and non-retryable 4xx do not retry.
- `adapter redacts configured API keys from diagnostics`: thrown source errors never contain the secret.
- `adapter preserves an empty event list as a successful snapshot`: no-event is distinct from unavailable.

- [ ] **Step 1: Write adapter tests and fixtures**

  Define the provider-neutral port surface:

  ```ts
  export interface OnChainFlowSourceRequest {
    readonly pair: "SOL/USDC";
    readonly fromUnixMs: number;
    readonly toUnixMs: number;
  }

  export interface OnChainFlowSourceSnapshot {
    readonly source: "helius-api" | "birdeye-api";
    readonly providerId: string;
    readonly providerRunId: string;
    readonly asOfUnixMs: number;
    readonly license: string;
    readonly retention: "bounded";
    readonly events: readonly OnChainFlowSourceEvent[];
  }

  export interface OnChainFlowSourcePort {
    collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot>;
  }
  ```

  `OnChainFlowSourceEvent` is a discriminated source-event union containing provider facts needed by Task 3. `OnChainFlowSourceError` has `timeout | network | unavailable | malformed`. Fixtures must include one event of every kind and an empty snapshot.

  Run:

  ```bash
  pnpm test tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts
  ```

  Expected: FAIL because the port and adapters do not exist.

- [ ] **Step 2: Implement the port, fake, and exports**

  Export the port from `src/ports/index.ts`. Implement a configurable fake that records requests and either returns a snapshot or throws a configured typed error; export it from `tests/fakes/index.ts`.

- [ ] **Step 3: Implement both HTTP adapters**

  Each adapter must validate `pair`, append encoded `fromUnixMs`/`toUnixMs` query parameters, authenticate using its configured header, call `HttpClient.getJson` with one HTTP attempt per outer adapter attempt, strictly validate the provider envelope and event discriminants, freeze the result, and map/redact failures. Use injected `RetryControl` and the established bounded exponential backoff pattern.

  Helius accepts transaction-backed events only. Birdeye accepts `dex_net_flow` only. A provider emitting a kind outside its allowlist is `malformed`.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts
  pnpm exec eslint src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts --max-warnings 0
  pnpm exec prettier --check src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts
  git commit -m "feat: add Helius and Birdeye flow source adapters"
  ```

## Repository Targets

### Expected Files

- src/ports/on-chain-flow-source.ts
- src/ports/index.ts
- src/adapters/node/http-helius-flow-source.ts
- src/adapters/node/http-birdeye-flow-source.ts
- tests/fakes/fake-on-chain-flow-source.ts
- tests/fakes/index.ts
- tests/adapters/node/http-helius-flow-source.test.ts
- tests/adapters/node/http-birdeye-flow-source.test.ts
- tests/fixtures/on-chain-flow.ts

## Validation Commands

```bash
pnpm test tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts
pnpm exec eslint src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts --max-warnings 0
pnpm exec prettier --check src/ports/on-chain-flow-source.ts src/ports/index.ts src/adapters/node/http-helius-flow-source.ts src/adapters/node/http-birdeye-flow-source.ts tests/fakes/fake-on-chain-flow-source.ts tests/fakes/index.ts tests/adapters/node/http-helius-flow-source.test.ts tests/adapters/node/http-birdeye-flow-source.test.ts tests/fixtures/on-chain-flow.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **factual Helius mapping**: The Helius adapter copies transaction facts and never invents motive. (Test: `Helius adapter maps transaction facts without adding motive`)
- **DEX window mapping**: The Birdeye adapter preserves SOL/USDC buy, sell, and signed net-flow window facts. (Test: `Birdeye adapter maps buy sell volumes and signed net flow for the requested window`)
- **malformed pre-persistence failure**: Malformed provider envelopes become typed malformed errors before application persistence. (Test: `adapter rejects a malformed source envelope before application persistence`)
- **bounded retries**: Only retryable failures are retried and attempts never exceed maxAttempts. (Test: `adapter retries retryable failures up to maxAttempts`)
- **secret redaction**: Typed adapter diagnostics cannot contain configured API keys. (Test: `adapter redacts configured API keys from diagnostics`)
- **empty success**: An empty event array is a valid successful snapshot, not an outage. (Test: `adapter preserves an empty event list as a successful snapshot`)
