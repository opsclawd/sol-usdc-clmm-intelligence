import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  HttpNewsSource,
  type HttpNewsSourceOptions
} from "../../src/adapters/node/http-news-source.js";
import type { RawObservationRepo } from "../../src/ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../../src/ports/normalized-observation-repo.js";
import {
  runNewsEvidenceJob,
  type NewsEvidenceJobDeps,
  type ConfiguredNewsSource,
  type NewsEvidenceJobResult,
  type NewsSourceKey
} from "../../src/jobs/news-evidence-job.js";
import { secretRedactingReplacer } from "../../src/domain/redact-secrets.js";

const KNOWN_SOURCES: readonly NewsSourceKey[] = ["crypto-news-api", "regulatory-monitor-api"];

function getSourceUrlEnvVar(source: NewsSourceKey): string {
  return `${source.toUpperCase().replace(/-/g, "_")}_URL`;
}

function getSourceApiKeyEnvVar(source: NewsSourceKey): string {
  return `${source.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

function parseAllowlist(rawAllowlist: string): NewsSourceKey[] {
  const trimmed = rawAllowlist.trim();
  if (trimmed.length === 0) {
    throw new Error("NEWS_SOURCE_ALLOWLIST cannot be empty");
  }

  const names = trimmed.split(",").map((name) => name.trim());
  const seen = new Set<NewsSourceKey>();
  const result: NewsSourceKey[] = [];

  for (const name of names) {
    if (name.length === 0) {
      throw new Error("Empty source name in allowlist");
    }

    const lowerName = name.toLowerCase() as NewsSourceKey;
    if (!KNOWN_SOURCES.includes(lowerName)) {
      throw new Error(
        `Unknown source name: ${name}. Known sources are: ${KNOWN_SOURCES.join(", ")}`
      );
    }

    if (seen.has(lowerName)) {
      throw new Error(`Duplicate source name: ${name}`);
    }

    seen.add(lowerName);
    result.push(lowerName);
  }

  return result;
}

function validateSourceConfig(source: NewsSourceKey, env: NodeRuntime["env"]): void {
  const urlVar = getSourceUrlEnvVar(source);
  const url = env.getOptional(urlVar);
  if (!url || url.length === 0) {
    throw new Error(`Missing required environment variable: ${urlVar}`);
  }
}

export function buildNewsSources(runtime: NodeRuntime): ConfiguredNewsSource[] {
  const rawAllowlist = runtime.env.getOptional("NEWS_SOURCE_ALLOWLIST");
  if (rawAllowlist === undefined) {
    throw new Error("Missing required environment variable: NEWS_SOURCE_ALLOWLIST");
  }
  if (rawAllowlist.trim().length === 0) {
    throw new Error("NEWS_SOURCE_ALLOWLIST cannot be empty");
  }
  const sourceNames = parseAllowlist(rawAllowlist);

  const sources: ConfiguredNewsSource[] = [];

  for (const sourceName of sourceNames) {
    validateSourceConfig(sourceName, runtime.env);

    const url = runtime.env.get(getSourceUrlEnvVar(sourceName));
    const apiKey = runtime.env.getOptional(getSourceApiKeyEnvVar(sourceName));

    const adapterOptions: HttpNewsSourceOptions =
      apiKey !== undefined
        ? {
            http: runtime.http,
            url,
            source: sourceName,
            retryControl: runtime.retryControl,
            apiKey
          }
        : {
            http: runtime.http,
            url,
            source: sourceName,
            retryControl: runtime.retryControl
          };
    const adapter = new HttpNewsSource(adapterOptions);

    sources.push({ source: sourceName, adapter });
  }

  return sources;
}

export async function runNewsEvidenceCollect(
  runtime: NodeRuntime,
  overrideSources?: { sources: ConfiguredNewsSource[] }
): Promise<NewsEvidenceJobResult> {
  const sources = overrideSources?.sources ?? buildNewsSources(runtime);

  let rawObservationRepo: RawObservationRepo;
  let normalizedObservationRepo: NormalizedObservationRepo;
  let persistence: Awaited<ReturnType<NodeRuntime["getPersistence"]>> | undefined;
  let collectionError: unknown;
  let result: NewsEvidenceJobResult | undefined;
  let closeError: unknown;

  try {
    persistence = await runtime.getPersistence();
    rawObservationRepo = persistence.rawObservationRepo;
    normalizedObservationRepo = persistence.normalizedObservationRepo;

    const deps: NewsEvidenceJobDeps = {
      sources,
      rawObservationRepo,
      normalizedObservationRepo,
      env: runtime.env,
      clock: runtime.clock,
      runIdFactory: runtime.runIdFactory
    };

    result = await runNewsEvidenceJob(deps);

    if (result.shouldFailCommand) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }

    console.log(JSON.stringify(result, secretRedactingReplacer, 2));
  } catch (err) {
    collectionError = err;
  } finally {
    if (persistence !== undefined) {
      try {
        await persistence.connection.close();
      } catch (err) {
        closeError = err;
        console.error("Failed to close database connection:", closeError);
        if (result !== undefined) {
          console.error(
            "Collection result before close failure:",
            JSON.stringify(result, secretRedactingReplacer, 2)
          );
        }
      }
    }
  }

  if (collectionError !== undefined) {
    throw collectionError;
  }

  if (closeError !== undefined) {
    throw closeError;
  }

  return result!;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await runNewsEvidenceCollect(runtime);
}

if (
  process.argv[1]?.endsWith("news-evidence.ts") ||
  process.argv[1]?.endsWith("news-evidence.js") ||
  process.argv[1]?.endsWith("news-evidence")
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
