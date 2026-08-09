import { FetchHttpClient } from "./fetch-http.js";
import { FsJsonStore } from "./fs-json-store.js";
import { FsTextReader } from "./fs-text-reader.js";
import { ProcessEnvReader } from "./process-env.js";
import { SystemClock } from "./system-clock.js";
import { SpawnCommandRunner } from "./spawn-command-runner.js";
import { SystemRetryControl } from "./system-retry.js";
import type { HttpClient } from "../../ports/http.js";
import type { JsonStore } from "../../ports/json-store.js";
import type { TextReader } from "../../ports/text-reader.js";
import type { EnvReader } from "../../ports/env.js";
import type { Clock } from "../../ports/clock.js";
import type { CommandRunner } from "../../ports/command-runner.js";
import type { DbConnection } from "../../ports/db.js";
import type { RawObservationRepo } from "../../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../ports/normalized-observation-repo.js";
import type { DerivedFeatureRepo } from "../../ports/feature-repo.js";
import type { RunIdFactory } from "../../ports/run-id.js";
import type { EvidenceBundleRepo } from "../../ports/bundle-repo.js";
import type { ResearchBriefRepo } from "../../ports/brief-repo.js";
import type { EvidenceBundleContract } from "../../ports/evidence-bundle-contract.js";
import type { PublishAttemptRepo } from "../../ports/publish-attempt-repo.js";
import type { RetryControl } from "../../ports/retry.js";
import type { ConfiguredPerpLiquidationSource } from "../../ports/perp-liquidation-source.js";
import type { LlmProvider } from "../../ports/llm-provider.js";
import type { PipelineRunLock } from "../../ports/pipeline-run-lock.js";
import { UuidRunIdFactory } from "./uuid-run-id-factory.js";

export interface Persistence {
  connection: DbConnection;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  featureRepo: DerivedFeatureRepo;
  bundleRepo: EvidenceBundleRepo;
  briefRepo: ResearchBriefRepo;
  publishAttemptRepo: PublishAttemptRepo;
}

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
  runIdFactory: RunIdFactory;
  retryControl: RetryControl;
  getDb(): Promise<DbConnection>;
  getPersistence(): Promise<Persistence>;
  getContract(): Promise<EvidenceBundleContract>;
  getLlmProvider?(): Promise<LlmProvider>;
  getPipelineRunLock?(): Promise<PipelineRunLock>;
  getPerpLiquidationSources?(options: {
    binanceBaseUrl: string;
    binanceSymbol: string;
    driftBaseUrl: string;
    driftSymbol: string;
    driftMarketIndex: number;
    driftPrecisions?: {
      pricePrecisionExp: number;
      basePrecisionExp: number;
      quotePrecisionExp: number;
    };
  }): Promise<readonly ConfiguredPerpLiquidationSource[]>;
}

export function createNodeRuntime(): NodeRuntime {
  const env = new ProcessEnvReader();
  const runIdFactory = new UuidRunIdFactory();
  const retryControl: RetryControl = new SystemRetryControl();
  let dbPromise: Promise<DbConnection> | undefined;
  let persistencePromise: Promise<Persistence> | undefined;
  let contractPromise: Promise<EvidenceBundleContract> | undefined;
  let llmProviderPromise: Promise<LlmProvider> | undefined;

  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env,
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner(),
    runIdFactory,
    retryControl,

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
          const { DrizzleFeatureRepo } = await import("./drizzle-feature-repo.js");
          const { DrizzleBundleRepo } = await import("./drizzle-bundle-repo.js");
          const { DrizzleBriefRepo } = await import("./drizzle-brief-repo.js");
          const { DrizzlePublishAttemptRepo } = await import("./drizzle-publish-attempt-repo.js");

          type DrizzlePgAdapterInstance = InstanceType<typeof DrizzlePgAdapter>;
          const connection = (await this.getDb()) as DrizzlePgAdapterInstance;
          const rawObservationRepo = new DrizzleObservationRepo(connection.db);
          const normalizedObservationRepo = new DrizzleNormalizedObservationRepo(connection.db);
          const featureRepo = new DrizzleFeatureRepo(connection.db);
          const bundleRepo = new DrizzleBundleRepo(connection.db);
          const briefRepo = new DrizzleBriefRepo(connection.db);
          const publishAttemptRepo = new DrizzlePublishAttemptRepo(connection.db);

          return {
            connection,
            rawObservationRepo,
            normalizedObservationRepo,
            featureRepo,
            bundleRepo,
            briefRepo,
            publishAttemptRepo
          };
        })();
      }
      return persistencePromise;
    },
    async getContract() {
      if (!contractPromise) {
        const { createEvidenceBundleContract } = await import("./evidence-bundle-v1-contract.js");
        contractPromise = Promise.resolve(createEvidenceBundleContract());
      }
      return contractPromise;
    },
    async getLlmProvider() {
      if (!llmProviderPromise) {
        const model = env.get("LLM_MODEL");
        const modelVersion = env.getOptional("LLM_MODEL_VERSION");

        // LLM_TRANSPORT=hermes routes generation through the local hermes CLI
        // instead of an HTTP endpoint. Used where the only working credential
        // belongs to a provider whose API ignores strict structured output
        // (see hermes-llm-provider.ts). Defaults to the HTTP adapter.
        if (env.getOptional("LLM_TRANSPORT") === "hermes") {
          const { HermesLlmProvider } = await import("./hermes-llm-provider.js");
          const { runHermesCommand } = await import("./hermes-command-runner.js");
          const hermesProvider = env.getOptional("LLM_HERMES_PROVIDER") ?? "hermes";

          if (!model) {
            throw new Error("Missing required LLM environment configuration (LLM_MODEL)");
          }

          llmProviderPromise = Promise.resolve(
            new HermesLlmProvider({
              run: runHermesCommand,
              model,
              provider: hermesProvider
            })
          );
          return llmProviderPromise;
        }

        const { OpenAiLlmProvider } = await import("./openai-llm-provider.js");
        const baseUrl = env.get("LLM_BASE_URL");
        const apiKey = env.get("LLM_API_KEY");

        if (!baseUrl || !apiKey || !model) {
          throw new Error(
            "Missing required LLM environment configuration (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)"
          );
        }

        llmProviderPromise = Promise.resolve(
          new OpenAiLlmProvider({
            http: this.http,
            baseUrl,
            apiKey,
            model,
            ...(modelVersion ? { modelVersion } : {})
          })
        );
      }
      return llmProviderPromise;
    },
    async getPipelineRunLock() {
      const { PgPipelineRunLock } = await import("./pg-pipeline-run-lock.js");
      return new PgPipelineRunLock(env);
    },
    async getPerpLiquidationSources(options) {
      const { HttpBinanceFapiSource } = await import("./http-binance-fapi-source.js");
      const { HttpDriftSource } = await import("./http-drift-source.js");

      const binanceAdapter = new HttpBinanceFapiSource({
        baseUrl: options.binanceBaseUrl,
        symbol: options.binanceSymbol,
        http: this.http,
        retry: this.retryControl
      });

      const driftAdapter = new HttpDriftSource({
        baseUrl: options.driftBaseUrl,
        symbol: options.driftSymbol,
        marketIndex: options.driftMarketIndex,
        http: this.http,
        retry: this.retryControl
      });

      return [
        { source: "binance-fapi", adapter: binanceAdapter },
        { source: "drift-api", adapter: driftAdapter }
      ];
    }
  };
}
