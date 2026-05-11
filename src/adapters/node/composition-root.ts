import { FetchHttpClient } from "./fetch-http.js";
import { FsJsonStore } from "./fs-json-store.js";
import { FsTextReader } from "./fs-text-reader.js";
import { ProcessEnvReader } from "./process-env.js";
import { SystemClock } from "./system-clock.js";
import { SpawnCommandRunner } from "./spawn-command-runner.js";
import { DrizzlePgAdapter } from "./drizzle-pg.js";
import type { HttpClient } from "../../ports/http.js";
import type { JsonStore } from "../../ports/json-store.js";
import type { TextReader } from "../../ports/text-reader.js";
import type { EnvReader } from "../../ports/env.js";
import type { Clock } from "../../ports/clock.js";
import type { CommandRunner } from "../../ports/command-runner.js";
import type { DbConnection } from "../../ports/db.js";

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
  db: DbConnection;
}

export function createNodeRuntime(): NodeRuntime {
  const env = new ProcessEnvReader();
  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env,
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner(),
    db: new DrizzlePgAdapter(env)
  };
}
