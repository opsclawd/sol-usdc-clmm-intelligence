import { describe, expect, it } from 'vitest';
import { collectBackendSnapshot } from '../../src/application/collect-backend-snapshot.js';
import { FakeHttp, FakeJsonStore, FakeEnv } from '../fakes/index.js';

describe('collectBackendSnapshot', () => {
  it('writes pool, position, and performance files when all sources succeed', async () => {
    const http = new FakeHttp();
    http.setResponse('http://api.test/api/clmm/sol-usdc/pool-snapshot', { body: { pool: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/position-snapshot', { body: { position: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/performance-snapshot', { body: { perf: 1 } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ CLMM_DATA_API_BASE: 'http://api.test' });

    const result = await collectBackendSnapshot({ http, jsonStore, env });

    expect(result.failures).toEqual([]);
    expect(jsonStore.writes.map((w) => w.path).sort()).toEqual([
      'data/latest-performance-snapshot.json',
      'data/latest-pool-snapshot.json',
      'data/latest-position-snapshot.json'
    ]);
  });

  it('returns failures array containing per-source errors without throwing', async () => {
    const http = new FakeHttp();
    http.setResponse('http://api.test/api/clmm/sol-usdc/pool-snapshot', { body: { pool: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/position-snapshot', { error: new Error('502 bad gateway') });
    http.setResponse('http://api.test/api/clmm/sol-usdc/performance-snapshot', { body: { perf: 1 } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ CLMM_DATA_API_BASE: 'http://api.test/' });

    const result = await collectBackendSnapshot({ http, jsonStore, env });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toBe('502 bad gateway');
    expect(jsonStore.writes.map((w) => w.path)).toEqual(
      expect.arrayContaining([
        'data/latest-pool-snapshot.json',
        'data/latest-performance-snapshot.json'
      ])
    );
  });

  it('throws when CLMM_DATA_API_BASE is unset', async () => {
    await expect(
      collectBackendSnapshot({
        http: new FakeHttp(),
        jsonStore: new FakeJsonStore(),
        env: new FakeEnv({})
      })
    ).rejects.toThrow('Missing required environment variable: CLMM_DATA_API_BASE');
  });
});