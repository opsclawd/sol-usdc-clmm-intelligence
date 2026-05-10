import { describe, expect, it } from 'vitest';
import { collectJupiterPrice } from '../../src/application/collect-jupiter-price.js';
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from '../fakes/index.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

describe('collectJupiterPrice', () => {
  it('writes data/latest-price-snapshot.json with usdPrice, source, and clock timestamp', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, {
      body: { [SOL_MINT]: { usdPrice: 175.42, blockId: 1, decimals: 9, priceChange24h: 0.5 } }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ SOL_MINT });
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await collectJupiterPrice({ http, jsonStore, env, clock });

    expect(jsonStore.writes[0]).toEqual({
      path: 'data/latest-price-snapshot.json',
      value: expect.objectContaining({
        pair: 'SOL/USDC',
        timestamp: '2026-05-10T12:30:00.000Z',
        source: 'jupiter-price-v3',
        priceUsd: 175.42,
        confidence: 'high'
      })
    });
  });

  it('uses default mint when SOL_MINT env is unset', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, { body: { [SOL_MINT]: { usdPrice: 1 } } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({});
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await collectJupiterPrice({ http, jsonStore, env, clock });
    expect(http.calls[0]?.url).toBe(url);
  });

  it('throws when usdPrice is missing in the response', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, { body: { [SOL_MINT]: {} } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ SOL_MINT });
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await expect(collectJupiterPrice({ http, jsonStore, env, clock })).rejects.toThrow(
      'Jupiter response did not include usdPrice for SOL'
    );
  });
});