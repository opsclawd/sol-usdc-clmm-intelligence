import { FetchHttpClient } from './fetch-http.js';
import { FsJsonStore } from './fs-json-store.js';
import { FsTextReader } from './fs-text-reader.js';
import { ProcessEnvReader } from './process-env.js';
import { SystemClock } from './system-clock.js';
import { SpawnCommandRunner } from './spawn-command-runner.js';
import type { HttpClient } from '../../ports/http.js';
import type { JsonStore } from '../../ports/json-store.js';
import type { TextReader } from '../../ports/text-reader.js';
import type { EnvReader } from '../../ports/env.js';
import type { Clock } from '../../ports/clock.js';
import type { CommandRunner } from '../../ports/command-runner.js';

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
}

export function createNodeRuntime(): NodeRuntime {
  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env: new ProcessEnvReader(),
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner()
  };
}