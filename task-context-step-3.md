# Task Context: Task 3

Title: Add the source port and Node HTTP adapter together

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-27
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-27
Start Commit: 8d258115c27c92c40909384db9d08dca77ae3750

## Task Requirements

**Files:**

- Create: `src/ports/support-resistance-source.ts`
- Modify: `src/ports/index.ts`
- Create: `src/adapters/node/http-support-resistance-source.ts`
- Create: `tests/fakes/fake-support-resistance-source.ts`
- Modify: `tests/fakes/index.ts`
- Create: `tests/adapters/node/http-support-resistance-source.test.ts`

**Port/interface atomicity:** this task adds `SupportResistanceSourcePort.collect` and includes both concrete implementations in the same task: `HttpSupportResistanceSource` for Node and `FakeSupportResistanceSource` for tests. Do not commit the port without both implementations; the automatic workspace `pnpm -r typecheck` gate must pass after this task.

**Exported API changes:** export `SupportResistanceSourcePort`, `SupportResistanceSourceRequest`, `SupportResistanceSourceError`, and `HttpSupportResistanceSource`. The required method shape is `collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot>`.

- [ ] **Step 1: Write adapter contract tests first.**

  Add exact cases:
  - `fetches SOL/USDC claims with bounded request options and an optional bearer credential`
  - `returns only the validated bounded snapshot and never retains unknown provider fields`
  - `classifies timeout network http status and malformed payload failures without leaking credentials`

  Configure the adapter through a constructor object containing `http`, `url`, optional `apiKey`, `timeoutMs: 5000`, and `maxAttempts: 2`. Assert the credential is sent only in the request header and no thrown diagnostic contains it.

- [ ] **Step 2: Run the adapter test and confirm it fails.**

  Run: `pnpm exec vitest run tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: FAIL because the port, fake, and adapter do not exist.

- [ ] **Step 3: Define the port and both implementations in one change.**

  Use a narrow request:

  ```ts
  export interface SupportResistanceSourceRequest {
    readonly pair: "SOL/USDC";
  }

  export interface SupportResistanceSourcePort {
    collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot>;
  }
  ```

  The HTTP adapter calls `getJson<unknown>`, passes the unknown response through `acceptSupportResistanceSnapshot`, and maps `HttpRequestError` to `SupportResistanceSourceError` kinds `timeout | network | unavailable | malformed`. Treat HTTP 404, 429, and 5xx as unavailable; invalid JSON or domain-validation failure as malformed; other transport failures as network. Store only configured fake responses in the test fake and record requests for assertions.

- [ ] **Step 4: Run focused verification.**

  Run: `pnpm exec vitest run tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: PASS for request shaping, bounded response projection, failure classification, and secret redaction.

  Run: `pnpm exec eslint src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts --max-warnings 0`

  Expected: exit 0.

  Run: `pnpm exec prettier --check src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts`

  Expected: all listed files use Prettier formatting.

- [ ] **Step 5: Commit the complete port/adapter slice.**

  ```bash
  git add src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts
  git commit -m "feat: add support resistance source adapter"
  ```

## Repository Targets

### Expected Files

- src/ports/support-resistance-source.ts
- src/ports/index.ts
- src/adapters/node/http-support-resistance-source.ts
- tests/fakes/fake-support-resistance-source.ts
- tests/fakes/index.ts
- tests/adapters/node/http-support-resistance-source.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/adapters/node/http-support-resistance-source.test.ts
pnpm exec eslint src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts --max-warnings 0
pnpm exec prettier --check src/ports/support-resistance-source.ts src/ports/index.ts src/adapters/node/http-support-resistance-source.ts tests/fakes/fake-support-resistance-source.ts tests/fakes/index.ts tests/adapters/node/http-support-resistance-source.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded-request-with-optional-auth**: The adapter requests SOL/USDC once with fixed timeout/attempt options and sends the optional credential only as a bearer header. (Test: `fetches SOL/USDC claims with bounded request options and an optional bearer credential`)
- **validated-projection-only**: The adapter returns the validated allowlisted snapshot and drops unknown provider fields before persistence can see them. (Test: `returns only the validated bounded snapshot and never retains unknown provider fields`)
- **safe-failure-classification**: Transport, status, JSON, and validation failures map to stable kinds without credentials in diagnostics. (Test: `classifies timeout network http status and malformed payload failures without leaking credentials`)
