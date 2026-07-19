# Price Observations Aggregation Design

## Context & Overview

In order to provide highly available and audit-resilient price evidence for regime engine decision-making, we aggregate independent outcomes from Pyth (oracle feed) and Jupiter (DEX route quotes). Rather than failing on a single source's unavailability, we preserve the durable outcomes of the surviving source while flagging partial status.

## Architecture & Data Flow

```
        ┌────────────────────────────────┐
        │  price-observations-job.ts     │
        └───────────────┬────────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
┌──────────────────┐          ┌──────────────────┐
│ collectPythPrice │          │collectJupiterQuote│
└──────────────────┘          └──────────────────┘
```

1. Launch both collection tasks concurrently using non-blocking promises.
2. Await both using `Promise.all` or `Promise.allSettled`.
3. Evaluate results:
   - Calculate `usableSourceCount` based on accepted/replay statuses.
   - Aggregate individual warning lists deterministically sorted.
   - Determine `shouldFailCommand` if zero usable sources or integrity conflicts exist.

## Verification & Error Handling

- Complete Success: Both sources accepted or identical replay. Exits `0`.
- Partial Success: One source accepted/replay, the other failed. Exits `0` but flags `isPartial: true`.
- Total Failure: Both sources unavailable. Exits `1`.
- Conflict: Integrity-level mismatch. Exits `1`.
