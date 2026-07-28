# Orca Collector Fix Design Document

## The Problem and Why It Matters

The Orca collector is currently failing with a 404 Not Found error because the API endpoint `/public/pool` has been deprecated and removed by Orca. Additionally, the old default pool address (`HJPn...`) is a deprecated address that is no longer returned by the active Orca pools API. As a result, the intelligence pipeline cannot collect pool statistics (TVL, volume, fees) for the SOL/USDC pool from Orca, resulting in degraded evidence bundles.

## Key Design Decisions and Trade-offs Considered

1. **Endpoint Choice (`/pools?addresses=<addr>` vs `/pools/<addr>`)**: The issue mentions `GET /pools?addresses=<addr>&stats=24h` returns an array wrapped in `{ data: [] }`. It also speculates that a single pool lookup `/pools/<addr>` _might_ exist. We choose to use `/pools?addresses=<addr>&stats=24h` because it is confirmed to work (even if it returns a list), guarantees we can fetch stats via query parameters, and easily aligns with standard list-fetching behavior. The trade-off is slightly more parsing logic to unwrap the array, but it provides a reliable, documented path.
2. **Missing Pool Fallback**: When the array response does not contain the requested address, we must decide whether to throw a specific validation error or return a generic failure. The decision is to throw an `OrcaPoolValidationError` indicating the address was not found, which correctly surfaces as a "malformed" or "unavailable" status gracefully in the pipeline, adhering to the "never fabricate values" rule.

## Proposed Approach with Rationale

1. **Update Collection URL**: In `src/application/collect-orca-pool-statistics.ts`, change the requested path to `/pools` and modify the query string to `?addresses=${poolAddress}&stats=24h`. This matches the live Orca API's requirements for retrieving pool data with 24-hour volume and fee stats.
2. **Update Response Parsing**: In `src/domain/pool-statistics/orca.ts`, modify `OrcaPoolResponse` and `acceptOrcaPoolResponse` to expect `{ data: Array<OrcaPoolData> }`. The validation logic will iterate through the `data` array, find the pool object where `address === configuredPoolAddress`, and then perform existing validations (tokens, timestamps, numbers) on that specific object.
3. **Update Default Configuration**: Replace the stale address (`HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw`) with the canonical pool address (`Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE`) across the codebase. This includes:
   - `.env.example`
   - `README.md`
   - `docs/operator-runbook.md`
   - `tests/fixtures/orca-pool.ts`
   - Test files like `tests/scripts/assemble-evidence-bundle.test.ts` and `tests/scripts/derive-mvp-features.test.ts`
   - `resources/sources.yaml`
4. **Update Test Fixtures**: Modify the test mock responses (e.g. in `tests/application/collect-orca-pool-statistics.test.ts` and related fixtures) to wrap the single pool object in an array (i.e. `{ data: [pool] }` instead of `{ data: pool }`), ensuring unit tests accurately reflect the new API shape.

## Assumptions Made

- The Orca API response shape wraps the array exactly as `{ "data": [ ...pools... ] }` and includes all previously verified fields (`tokenA`, `tokenB`, `updatedAt`, `updatedSlot`, `tvlUsdc`, `stats`).
- The `volume24hUsdc` and `fees24hUsdc` fields within the `stats` block retain their decimal string format.
- Passing `?addresses=<addr>` does filter the response or at least returns our target address in the `data` array.
- There are no other API breaking changes (like token mint representations or pagination objects) that affect this specific endpoint beyond the array wrapping.

## Scope

**In Scope:**

- Updating the HTTP path and query parameters for Orca pool collection.
- Refactoring `acceptOrcaPoolResponse` to unwrap the `{ data: [] }` array.
- Replacing the stale pool address string globally.
- Updating all corresponding unit test fixtures and documentation.

**Out of Scope:**

- Modifying other adapters (e.g., Raydium, Meteora).
- Handling paginated API responses (we assume `addresses=<addr>` restricts the response to a manageable size, containing our target).
- Collecting additional metrics beyond what is currently defined in `OrcaPoolData`.
- Altering the domain schema for normalized observations.

## Risks or Concerns Identified

- **Test Fixture Pervasiveness**: The stale pool address (`HJPn...`) is extensively hardcoded in large test files (`assemble-evidence-bundle.test.ts`). A global find-and-replace is required and must be done carefully to avoid breaking test assertions that might rely on the specific string length or format, although unlikely.
- **Strict Array Parsing**: If the API occasionally returns `{ data: null }` or `{ data: {} }` upon errors instead of `{ data: [] }`, the parser must correctly handle these edge cases without throwing unhandled exceptions, mapping them neatly to `OrcaPoolValidationError`.
