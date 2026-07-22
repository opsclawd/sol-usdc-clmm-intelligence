# Task Context: Task 1

Title: Add single-attempt bounded raw POST HTTP operation and RetryControl port

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-13
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-13
Start Commit: 6abbf0c97574a6b795be47dfb1e295226f6085bf

## Task Requirements

**Files:**

- Modify: `src/ports/http.ts`
- Modify: `src/ports/index.ts`
- Modify: `src/adapters/node/fetch-http.ts`
- Modify: `tests/fakes/fake-http.ts`
- Modify: `tests/adapters/node/fetch-http.test.ts` (only add a new `postJsonRaw` describe block; do not rewrite existing GET cases)
- Create: `src/ports/retry.ts`
- Create: `src/adapters/node/system-retry.ts`
- Create: `tests/fakes/fake-retry.ts`
- Modify: `tests/fakes/index.ts`
- Modify: `src/adapters/node/composition-root.ts`

**Signature changes:** `HttpClient` gains required `postJsonRaw<T>()`; new exported `HttpResponse<T>` describes status, `ok`, bounded parsed-or-text body, and normalized headers. `RetryControl` port and both production/fake implementations are introduced so `PublishEvidenceBundleDeps` can reference it as optional from Task 2 onward.

- [ ] Write failing adapter tests named `postJsonRaw sends one JSON POST with caller headers and no implicit retry`, `postJsonRaw returns non-2xx status body and headers without throwing`, `postJsonRaw bounds UTF-8 response capture to 10240 bytes`, `postJsonRaw timeout covers response body reading`, and `postJsonRaw converts fetch and body-read transport failures to HttpRequestError`. Assert `method: "POST"`, `Content-Type: application/json`, caller authorization/idempotency headers, one fetch call even for 429/503, and a fresh abort signal.
- [ ] Define the port shape before implementation:

  ```ts
  export interface HttpResponse<T = unknown> {
    readonly status: number;
    readonly ok: boolean;
    readonly body: T;
    readonly headers: Readonly<Record<string, string>>;
  }

  export interface HttpClient {
    getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
    postJsonRaw<T = unknown>(
      url: string,
      body: unknown,
      options?: HttpRequestOptions
    ): Promise<HttpResponse<T>>;
  }
  ```

- [ ] Implement `postJsonRaw` as exactly one fetch call. Start one timeout before fetch and clear it only after bounded body reading; read at most 10,240 UTF-8 bytes from the response stream, cancel the reader after the bound, parse complete valid JSON and otherwise retain text, normalize response headers, return all HTTP statuses, and throw `HttpRequestError` only for timeout/network/body-read transport failures. Do not reuse the GET retry loop.
- [ ] Extend `FakeHttp` with queued POST responses/errors and call records that retain the exact body reference and options; keep existing GET behavior compatible.
- [ ] Add `RetryControl` injectable port and implementations:

  ```ts
  export interface RetryControl {
    sleep(ms: number): Promise<void>;
    jitterUnit(): number; // finite value in [0, 1]
  }
  ```

  `SystemRetryControl` uses `setTimeout` and `Math.random`; `FakeRetry` records delays and returns queued jitter values.

- [ ] Wire `RetryControl` into `NodeRuntime`; export both `RetryControl` and `SystemRetryControl` from their respective index files.
- [ ] Run the scoped tests and inspect only the new section:

  ```bash
  pnpm vitest run tests/adapters/node/fetch-http.test.ts -t postJsonRaw
  sed -n '/describe("postJsonRaw"/,/^  });/p' tests/adapters/node/fetch-http.test.ts
  ```

- [ ] Commit: `git add src/ports/http.ts src/ports/index.ts src/ports/retry.ts src/adapters/node/fetch-http.ts src/adapters/node/system-retry.ts src/adapters/node/composition-root.ts tests/fakes/fake-http.ts tests/fakes/fake-retry.ts tests/fakes/index.ts tests/adapters/node/fetch-http.test.ts && git commit -m "feat: add auditable raw JSON POST transport and RetryControl port"`

## Repository Targets

### Expected Files

- src/ports/http.ts
- src/ports/index.ts
- src/ports/retry.ts
- src/adapters/node/fetch-http.ts
- src/adapters/node/system-retry.ts
- src/adapters/node/composition-root.ts
- tests/fakes/fake-http.ts
- tests/fakes/fake-retry.ts
- tests/fakes/index.ts
- tests/adapters/node/fetch-http.test.ts

## Validation Commands

```bash
pnpm vitest run tests/adapters/node/fetch-http.test.ts -t postJsonRaw
sed -n '/describe("postJsonRaw"/,/^  });/p' tests/adapters/node/fetch-http.test.ts
```
