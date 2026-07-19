# Task Context: Task 1

Title: Add bounded typed HTTP GET behavior

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-23
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-23
Start Commit: 6a3197f1ad619c2594d8a693577cd6c67b3689f1

## Task Requirements

**Files:**

- Modify: `src/ports/http.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/fetch-http.ts`
- Modify: `tests/fakes/fake-http.ts`
- Create: `tests/adapters/node/fetch-http.test.ts`
- Modify: `src/application/collect-clmm-bundle.ts`
- Modify: `src/application/collect-coingecko.ts`
- Modify: `src/application/collect-jupiter-price.ts`
- Modify: `tests/application/ancillary-collectors.test.ts`
- Modify: `tests/application/collect-jupiter-price.test.ts`

**Exported API changes:** Change `HttpClient.getJson` to accept one options object and export the policy/error vocabulary used by collectors:

```ts
export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export type HttpFailureKind = "timeout" | "network" | "http_status" | "invalid_json";

export class HttpRequestError extends Error {
  constructor(
    readonly kind: HttpFailureKind,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: ErrorOptions
  );
}

export interface HttpClient {
  getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
}
```

- [ ] **Step 1: Write the transport policy tests first.** In `tests/adapters/node/fetch-http.test.ts`, inject a fetch-compatible function and fake timers/abort-aware promises to name and cover: `retries timeout and retryable failures at most once before succeeding or throwing`, `does not retry non-retryable HTTP failures or invalid JSON`, 408/429/5xx retries, network retry, a new signal for each attempt, response-body truncation/redaction in error summaries, and default single-attempt compatibility. Update `FakeHttp.calls` to capture options and allow queued responses; update the existing CoinGecko header assertion to expect `options.headers`.
- [ ] **Step 2: Run the focused tests and confirm the signature/behavior failures.** Run `pnpm exec vitest run tests/adapters/node/fetch-http.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-price.test.ts tests/application/ancillary-collectors.test.ts`; expect failures because the options signature, error class, fetch injection, retry loop, and authenticated caller argument shapes are not implemented.
- [ ] **Step 3: Implement the port and all implementations in the same task.** Update `FetchHttpClient` to create/clear an `AbortController` per attempt, classify only network/timeout/408/429/5xx as retryable, parse JSON inside the classified attempt, and stop at `maxAttempts`. Export the new types/error from `src/ports/index.ts`, update `FakeHttp`, and change CLMM and CoinGecko calls from bare headers to `{ headers: ... }`; do not persist error bodies or credentials.
- [ ] **Step 4: Update the existing Jupiter price collector and its test to use the new options signature.** In `src/application/collect-jupiter-price.ts` and `tests/application/collect-jupiter-price.test.ts`, change all `http.getJson` calls to pass the headers inside `{ headers: ... }`; the test's `FakeHttp` queue must also reflect the new call shape. This ensures the workspace typechecks after Task 1 before Task 8 introduces the new `collectJupiterQuote` use case.
- [ ] **Step 5: Verify this task.** Run `pnpm exec vitest run tests/adapters/node/fetch-http.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-price.test.ts tests/application/ancillary-collectors.test.ts` and `pnpm exec eslint src/ports/http.ts src/ports/index.ts src/adapters/node/fetch-http.ts tests/fakes/fake-http.ts tests/adapters/node/fetch-http.test.ts src/application/collect-clmm-bundle.ts src/application/collect-coingecko.ts src/application/collect-jupiter-price.ts tests/application/ancillary-collectors.test.ts tests/application/collect-jupiter-price.test.ts`; expect all selected tests and lint checks to pass.
- [ ] **Step 6: Commit.** Run `git add src/ports/http.ts src/ports/index.ts src/adapters/node/fetch-http.ts tests/fakes/fake-http.ts tests/adapters/node/fetch-http.test.ts src/application/collect-clmm-bundle.ts src/application/collect-coingecko.ts src/application/collect-jupiter-price.ts tests/application/ancillary-collectors.test.ts tests/application/collect-jupiter-price.test.ts && git commit -m "feat: bound collector HTTP requests"`.

## Repository Targets

### Expected Files

- src/ports/http.ts
- src/ports/index.ts
- src/adapters/node/fetch-http.ts
- tests/fakes/fake-http.ts
- tests/adapters/node/fetch-http.test.ts
- src/application/collect-clmm-bundle.ts
- src/application/collect-coingecko.ts
- src/application/collect-jupiter-price.ts
- tests/application/collect-jupiter-price.test.ts
- tests/application/ancillary-collectors.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/adapters/node/fetch-http.test.ts tests/application/collect-clmm-bundle.test.ts tests/application/collect-jupiter-price.test.ts tests/application/ancillary-collectors.test.ts
pnpm exec eslint src/ports/http.ts src/ports/index.ts src/adapters/node/fetch-http.ts tests/fakes/fake-http.ts tests/adapters/node/fetch-http.test.ts src/application/collect-clmm-bundle.ts src/application/collect-coingecko.ts src/application/collect-jupiter-price.ts tests/application/ancillary-collectors.test.ts tests/application/collect-jupiter-price.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded retry policy**: Each attempt has a five-second abort signal, only network errors, timeouts, 408, 429, and 5xx retry, and no request exceeds two attempts. (Test: `retries timeout and retryable failures at most once before succeeding or throwing`)
- **non-retryable failures stop**: Other 4xx statuses and invalid JSON stop after the first attempt with a typed safe error. (Test: `does not retry non-retryable HTTP failures or invalid JSON`)
