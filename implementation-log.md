# Implementation Log

## Task 2: Apply Bounded Rate-Limit Guidance to Birdeye Page Retries

### Summary of Implementation

- Modified `src/adapters/node/http-birdeye-flow-source.ts` to implement bounded rate-limit parsing and decision logic for HTTP 429 status responses.
  - Added module-private helpers `getHeaderCaseInsensitive` and `parseRateLimitDelayMs` with a `MAX_RATE_LIMIT_DELAY_MS` cap of 60,000 ms.
  - Supports `Retry-After` (integer seconds and HTTP-date formats) with priority over `X-RateLimit-Reset` (Unix timestamp in seconds).
  - Handles header names case-insensitively.
  - Returns `null` when rate limit guidance is missing, invalid, non-finite, or exceeds 60 seconds, which immediately aborts the page retry loop and throws an unavailable error without sleeping.
  - Updated the retry loop in `fetchPageWithRetry` to handle HTTP 429 errors explicitly before fallback backoff.
- Created `tests/adapters/node/http-birdeye-flow-source-rate-limit.test.ts` covering all required behavioral invariants:
  1. `retries a 429 after Retry-After delta seconds`
  2. `retries a 429 after Retry-After HTTP-date`
  3. `uses X-RateLimit-Reset when Retry-After is absent`
  4. `prefers Retry-After when both rate-limit headers are present`
  5. `matches rate-limit response headers case-insensitively`
  6. `aborts a 429 when rate-limit guidance is missing invalid or over the cap`
  7. `does not sleep after the final 429 attempt`
  8. `keeps generic backoff for retryable non-429 failures`
  9. `retries only the failed Birdeye page after a bounded 429 delay`
- Updated `tests/adapters/node/http-birdeye-flow-source-mapping.test.ts`:
  - Renamed `retries 429 rate limit errors up to maxAttempts` to `does not retry 429 rate limit errors without retry guidance` and updated the expected `getJson` call count from 3 to 1.

### Verification Results

- `pnpm exec vitest run tests/adapters/node/http-birdeye-flow-source-rate-limit.test.ts tests/adapters/node/http-birdeye-flow-source-mapping.test.ts` passed (43/43 tests pass).
- `pnpm exec eslint` passed clean.
- `pnpm exec prettier --check` passed clean.
- `pnpm -r typecheck` passed clean.
