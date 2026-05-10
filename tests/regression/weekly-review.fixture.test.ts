import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateWeeklyReview } from '../../src/application/generate-weekly-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

const FIXED_NOW = '2026-05-09T13:00:00.000Z';
async function loadJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }

describe('weekly-review regression', () => {
  it('matches the captured stale output', async () => {
    const result = await generateWeeklyReview({ jsonStore: new FakeJsonStore(), clock: new FakeClock(FIXED_NOW) });
    expect(result).toEqual(await loadJson('tests/fixtures/expected/weekly-review-stale.json'));
  });
});