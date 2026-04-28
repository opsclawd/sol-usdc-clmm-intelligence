import { getJson } from '../lib/http.js';
import { writeJsonFile } from '../lib/fs.js';

async function main(): Promise<void> {
  // Placeholder collector. Keep raw chain fundamentals outside Git in production.
  const chainTvl = await getJson<unknown>('https://api.llama.fi/v2/chains');
  await writeJsonFile('data/latest-defillama-solana-raw.json', {
    timestamp: new Date().toISOString(),
    source: 'defillama',
    raw: chainTvl
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
