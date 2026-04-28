import { getEnv } from '../lib/env.js';
import { getJson } from '../lib/http.js';
import { writeJsonFile } from '../lib/fs.js';

async function writeIfAvailable(path: string, url: string): Promise<void> {
  const value = await getJson<unknown>(url);
  await writeJsonFile(path, value);
}

async function main(): Promise<void> {
  const base = getEnv('CLMM_DATA_API_BASE');
  const normalized = base.replace(/\/$/, '');

  await Promise.allSettled([
    writeIfAvailable('data/latest-pool-snapshot.json', `${normalized}/api/clmm/sol-usdc/pool-snapshot`),
    writeIfAvailable('data/latest-position-snapshot.json', `${normalized}/api/clmm/sol-usdc/position-snapshot`),
    writeIfAvailable('data/latest-performance-snapshot.json', `${normalized}/api/clmm/sol-usdc/performance-snapshot`)
  ]).then((results) => {
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error((failure as PromiseRejectedResult).reason);
      }
      process.exitCode = 1;
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
