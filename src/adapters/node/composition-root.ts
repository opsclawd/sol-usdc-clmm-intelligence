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
import type { RawObservationRepo } from "../../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../ports/normalized-observation-repo.js";

export interface Persistence {
  connection: DbConnection;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
}

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
  getDb(): Promise<DbConnection>;
  getPersistence(): Promise<Persistence>;
}

export function createNodeRuntime(): NodeRuntime {
  // Resolves environment variables including JUPITER_API_BASE and JUPITER_API_KEY
  const env = new ProcessEnvReader();
  let dbPromise: Promise<DbConnection> | undefined;
  let persistencePromise: Promise<Persistence> | undefined;

  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env,
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner(),
    async getDb() {
      if (!dbPromise) {
        const { DrizzlePgAdapter } = await import("./drizzle-pg.js");
        dbPromise = Promise.resolve(new DrizzlePgAdapter(env));
      }
      return dbPromise;
    },
    async getPersistence() {
      if (!persistencePromise) {
        persistencePromise = (async () => {
          const { DrizzlePgAdapter } = await import("./drizzle-pg.js");
          const { DrizzleObservationRepo } = await import("./drizzle-observation-repo.js");
          const { DrizzleNormalizedObservationRepo } =
            await import("./drizzle-normalized-observation-repo.js");

          type DrizzlePgAdapterInstance = InstanceType<typeof DrizzlePgAdapter>;
          const connection = (await this.getDb()) as DrizzlePgAdapterInstance;
          const rawObservationRepo = new DrizzleObservationRepo(connection.db);
          const normalizedObservationRepo = new DrizzleNormalizedObservationRepo(connection.db);

          return { connection, rawObservationRepo, normalizedObservationRepo };
        })();
      }
      return persistencePromise;
    }
  };
}
