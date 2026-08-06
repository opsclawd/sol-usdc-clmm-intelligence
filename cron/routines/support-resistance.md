Collect SOL/USDC support/resistance evidence by running `pnpm collect:support-resistance`.

This routine collects SOL/USDC support and resistance levels from configured external sources on a four-hour schedule (`15 */4 * * *`). The four-hour collection cadence is separate from downstream evidence bundle synthesis and policy generation.

## Authority Boundaries

**This routine does NOT:**

- Synthesize policy or make policy decisions (regime-engine owns final PolicyInsight synthesis)
- Infer market direction or make trading recommendations
- Execute transactions, move liquidity, or manage positions
- Treat support/resistance levels as execution triggers

## Cadence and Freshness

- **Schedule Cadence**: Runs every four hours at minute 15 (`15 */4 * * *`). This collection interval is independent of evidence bundle assembly schedules.
- **Expiry-Aware Collection**: Collected observations remain strictly expiry-gated. Fresh support/resistance observations are valid until their specified `expiresAtUnixMs` timestamp; stale observations (past expiry) are excluded from active selection but retained for audit lineage.
- **Missing Coverage as Degradation**: Missing coverage, empty source payloads, or provider errors are diagnostic degradation states, not a determination of "no levels." When data is missing, stale, or unavailable, downstream assembly treats the signal as degraded rather than assuming level-free market conditions.
