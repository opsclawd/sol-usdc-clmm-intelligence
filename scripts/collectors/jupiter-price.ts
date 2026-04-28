import { getEnv } from '../lib/env.js';
import { getJson } from '../lib/http.js';
import { writeJsonFile } from '../lib/fs.js';

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice?: number;
    blockId?: number;
    decimals?: number;
    priceChange24h?: number;
  };
}

async function main(): Promise<void> {
  const solMint = getEnv('SOL_MINT', 'So11111111111111111111111111111111111111112');
  const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(solMint)}`;
  const response = await getJson<JupiterPriceResponse>(url);
  const row = response[solMint];

  if (!row?.usdPrice) {
    throw new Error('Jupiter response did not include usdPrice for SOL');
  }

  await writeJsonFile('data/latest-price-snapshot.json', {
    pair: 'SOL/USDC',
    timestamp: new Date().toISOString(),
    source: 'jupiter-price-v3',
    priceUsd: row.usdPrice,
    confidence: 'high',
    raw: row
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
