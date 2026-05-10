import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderCronCommands } from '../../src/application/render-cron-commands.js';
import { FakeTextReader, FakeEnv } from '../fakes/index.js';

describe('cron-render regression', () => {
  it('matches the captured render output', async () => {
    const yaml = await readFile('tests/fixtures/cron/jobs.yaml', 'utf8');
    const routine = await readFile('tests/fixtures/cron/routines/daily.md', 'utf8');
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('tests/fixtures/cron/routines/daily.md', routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: 'opus' });

    const lines = await renderCronCommands({ textReader, env });
    const expected = (await readFile('tests/fixtures/expected/cron-render.txt', 'utf8')).trimEnd();
    expect(lines.join('\n')).toBe(expected);
  });
});