import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateDailyInsight } from '../../src/application/generate-daily-insight.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

const FIXED_NOW = '2026-05-09T13:00:00.000Z';

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('daily-insight regression', () => {
  it('matches the captured complete-data output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed(
      'data/latest-price-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-price-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-pool-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-pool-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-position-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-position-snapshot.json')
    );
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-complete.json');
    expect(result).toEqual(expected);
  });

  it('matches the captured partial-data output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed(
      'data/latest-price-snapshot.json',
      await loadJson('tests/fixtures/snapshots/partial/latest-price-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-pool-snapshot.json',
      await loadJson('tests/fixtures/snapshots/partial/latest-pool-snapshot.json')
    );
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-partial.json');
    expect(result).toEqual(expected);
  });

  it('matches the captured stale output', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-stale.json');
    expect(result).toEqual(expected);
  });
});