# Source Priority

## Deterministic source priority

1. Your backend/database snapshots.
2. Raydium pool and position data.
3. Jupiter price sanity check.
4. DeFiLlama chain and DEX metrics.
5. CoinGecko market data.
6. Official Solana/Raydium/Jupiter/Helius updates.
7. General news and social narratives.

## Conflict handling

When sources conflict:

- Trust backend/Raydium/Jupiter for price/pool state.
- Trust DeFiLlama/CoinGecko only for aggregated market/fundamental context.
- Do not use news to override direct pool/position math.
- Mark output as `partial` when data is contradictory.
