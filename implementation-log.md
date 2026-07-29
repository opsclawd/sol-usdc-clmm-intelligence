# Implementation Log - Task 1

## Task 1: Propagate Failed GET Response Headers Through HttpRequestError

### Implemented Changes

- Added `HttpRequestErrorOptions` interface extending `ErrorOptions` with optional `responseHeaders` property in `src/ports/http.ts`.
- Updated `HttpRequestError` class constructor to accept `HttpRequestErrorOptions` and set `readonly responseHeaders?: Readonly<Record<string, string>>`.
- Updated `FetchHttpClient` in `src/adapters/node/fetch-http.ts` to convert non-2xx GET response headers using `responseHeadersToRecord` and pass them into `HttpRequestError`.
- Created tests in `tests/adapters/node/fetch-http-error-headers.test.ts` verifying header retention and cause preservation.

### Verification

- `pnpm exec vitest run tests/adapters/node/fetch-http-error-headers.test.ts`: Passed (2 tests)
- `pnpm exec eslint`: Passed
- `pnpm exec prettier`: Passed
- `pnpm verify` (typecheck, lint, format, full test suite 150 test files / 2201 tests, boundaries): Passed
- Commit `56e4498`: `feat: expose failed HTTP response headers`
