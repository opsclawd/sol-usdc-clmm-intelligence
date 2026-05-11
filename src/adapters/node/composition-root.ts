import { FetchHttpClient } from "./fetch-http.js";
import { FsJsonStore } from "./fs-json-store.js";
import { FsTextReader } from "./fs-text-reader.js";
import { ProcessEnvReader } from "./process-env.js";
import { SystemClock } from "./system-clock.js";
import { SpawnCommandRunner } from "./spawn-command-runner.js";
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
  getDb(): Promise<DbConnection>;
}

export function createNodeRuntime(): NodeRuntime {
  const env = new ProcessEnvReader();
  let dbPromise: Promise<DbConnection> | undefined;
  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env,
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner(),
    async getDb() {
      if (!dbPromise) {
        if (!env.get("DATABASE_URL")) {
          throw new Error("DATABASE_URL is not configured");
        }
        const { DrizzlePgAdapter } = await import("./drizzle-pg.js");
        dbPromise = Promise.resolve(new DrizzlePgAdapter(env));
      }
      return dbPromise;
    }
  };
}
