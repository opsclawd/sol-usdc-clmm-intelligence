# Implementation Log - Task 9

## Overview

Implemented Task 9: Document Orca semantics, configuration, operation, and the deferred gap.

## Changes

1. **Configuration**:
   - Added `ORCA_API_BASE=https://api.orca.so/v2/solana` and `ORCA_SOL_USDC_WHIRLPOOL=HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw` configurations in `.env.example`.
2. **Sources Registry**:
   - Registered `orca-public-api` in `resources/sources.yaml` with the detailed pool endpoint, 24h stats window, 5s/2-attempt policy, and rate-limiting limitations.
   - Documented the deferred Solana network-health/status ingestion backlog gap under `official-solana-updates` limitations.
3. **Architecture & README**:
   - Updated `docs/architecture.md` and `README.md` to describe the 4-source raw-first core set, single run context correlation via `runId`, independent persistence, non-transactional leaf actions, and the fixed status truth table (`COMPLETE`, `PARTIAL`, `UNAVAILABLE`, `FAILED`).
   - Defined `tvlUsdc`, `volume24hUsdc`, and `fees24hUsdc` as USDC-denominated decimal strings (not raw liquidity, wallet fees, LP-only revenue, APR, or guaranteed USD).
   - Recorded the backlog gap of Solana network health ingestion as deferred.
4. **Operator Runbook**:
   - Documented `pnpm collect:core` and standard configurations.
   - Described COMPLETE/PARTIAL/UNAVAILABLE/FAILED exit code behaviors.
   - Outlined 429/outage troubleshooting and safe database query inspect instructions.
