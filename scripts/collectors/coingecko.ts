import { getOptionalEnv } from '../lib/env.js';
import { getJson } from '../lib/http.js';
import { writeJsonFile } from '../lib/fs.js';

async function main(): Promise<void> {
  const apiKey = getOptionalEnv('COINGECKO_API_KEY');
  const headers = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  const url = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
  const raw = await getJson<unknown>(url, headers);
  await writeJsonFile('data/latest-coingecko-solana-raw.json', {
    timestamp: new Date().toISOString(),
    source: 'coingecko',
    raw
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
