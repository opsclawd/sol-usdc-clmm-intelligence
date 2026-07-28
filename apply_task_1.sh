#!/bin/bash
sed -i 's/readonly slot: number;/readonly slot?: number;/' src/contracts/on-chain-flow.ts
sed -i 's/slot: z.number().int().nonnegative(),/slot: z.number().int().nonnegative().optional(),/' src/domain/on-chain-flow/validate.ts
sed -i '/birdeyeNetFlowSchema,/d' src/domain/on-chain-flow/validate.ts
pnpm run typecheck > typecheck_output.txt 2>&1
