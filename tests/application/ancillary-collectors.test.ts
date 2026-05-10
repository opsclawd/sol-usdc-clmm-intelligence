import { describe, expect, it } from 'vitest';
import { collectCoingecko } from '../../src/application/collect-coingecko.js';
import { collectDefillama } from '../../src/application/collect-defillama.js';
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from '../fakes/index.js';

describe('collectCoingecko', () => {
  it('writes data/latest-coingecko-solana-raw.json with timestamp', async () => {
    const http = new FakeHttp();
    const url = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
    http.setResponse(url, { body: { id: 'solana' } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ COINGECKO_API_KEY: 'k' });
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');

    await collectCoingecko({ http, jsonStore, env, clock });

    expect(http.calls[0]).toEqual({ url, headers: { 'x-cg-demo-api-key': 'k' } });
    expect(jsonStore.writes[0]?.path).toBe('data/latest-coingecko-solana-raw.json');
  });

  it('omits api-key header when COINGECKO_API_KEY is unset', async () => {
    const http = new FakeHttp();
    const url = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
    http.setResponse(url, { body: {} });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({});
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');

    await collectCoingecko({ http, jsonStore, env, clock });
    expect(http.calls[0]?.headers).toEqual({});
  });
});

describe('collectDefillama', () => {
  it('writes data/latest-defillama-solana-raw.json with timestamp', async () => {
    const http = new FakeHttp();
    http.setResponse('https://api.llama.fi/v2/chains', { body: [{ name: 'Solana' }] });
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');
    await collectDefillama({ http, jsonStore, clock });
    expect(jsonStore.writes[0]?.path).toBe('data/latest-defillama-solana-raw.json');
  });
});