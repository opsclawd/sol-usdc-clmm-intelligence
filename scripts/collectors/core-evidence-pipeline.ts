import { createNodeRuntime, type NodeRuntime } from "../../src/adapters/node/composition-root.js";
import {
  loadCoreEvidencePipelineConfig,
  type CoreEvidencePipelineConfig
} from "../../src/application/load-core-evidence-pipeline-config.js";
import { coreEvidencePipelineJob } from "../../src/jobs/core-evidence-pipeline-job.js";
import {
  runCoreCollectionJob,
  type CoreCollectionJobDeps
} from "../../src/jobs/core-collection-job.js";
import {
  deriveMvpFeatures,
  type DeriveMvpFeaturesDeps
} from "../../src/application/derive-mvp-features.js";
import {
  assembleEvidenceBundle,
  type AssembleEvidenceBundleDeps
} from "../../src/application/assemble-evidence-bundle.js";
import {
  generateResearchBrief,
  type GenerateResearchBriefDeps
} from "../../src/application/generate-research-brief.js";
import {
  publishEvidenceBundle,
  type PublishEvidenceBundleDeps
} from "../../src/application/publish-evidence-bundle.js";
import { redactSecretMentions, secretRedactingReplacer } from "../../src/domain/redact-secrets.js";

export async function runCoreEvidencePipelineScript(runtime: NodeRuntime): Promise<void> {
  let config: CoreEvidencePipelineConfig;
  try {
    config = loadCoreEvidencePipelineConfig(runtime.env);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const redactedMessage = redactSecretMentions(rawMsg);
    const preflightResult = {
      pipelineRunId: null,
      collectionStartedAtUnixMs: null,
      evaluationTimeUnixMs: null,
      collectionStatus: null,
      positions: [],
      status: "failed",
      warnings: [],
      diagnostics: [
        {
          stage: "preflight",
          code: "CONFIG_INVALID",
          message: redactedMessage
        }
      ],
      cleanupErrors: []
    };
    console.log(JSON.stringify(preflightResult, secretRedactingReplacer));
    process.exitCode = 1;
    return;
  }

  if (!runtime.getPipelineRunLock) {
    throw new Error("NodeRuntime missing getPipelineRunLock factory method");
  }

  const lock = await runtime.getPipelineRunLock();

  const job = coreEvidencePipelineJob({
    clock: runtime.clock,
    runIdFactory: runtime.runIdFactory,
    lock,
    openResources: async () => {
      const persistence = await runtime.getPersistence();

      try {
        const contract = await runtime.getContract();
        const llmProvider = runtime.getLlmProvider ? await runtime.getLlmProvider() : undefined;

        if (!llmProvider) {
          throw new Error("LLM provider unavailable from NodeRuntime");
        }

        const coreDeps: CoreCollectionJobDeps = {
          http: runtime.http,
          retryControl: runtime.retryControl,
          jsonStore: runtime.jsonStore,
          env: runtime.env,
          clock: runtime.clock,
          rawObservationRepo: persistence.rawObservationRepo,
          normalizedObservationRepo: persistence.normalizedObservationRepo,
          runIdFactory: runtime.runIdFactory
        };

        const deriveDeps: DeriveMvpFeaturesDeps = {
          normalizedObservationRepo: persistence.normalizedObservationRepo,
          featureRepo: persistence.featureRepo
        };

        const assembleDeps: AssembleEvidenceBundleDeps = {
          clock: runtime.clock,
          featureRepo: persistence.featureRepo,
          normalizedRepo: persistence.normalizedObservationRepo,
          rawRepo: persistence.rawObservationRepo,
          bundleRepo: persistence.bundleRepo,
          contract
        };

        const briefDeps: GenerateResearchBriefDeps = {
          bundleRepo: persistence.bundleRepo,
          briefRepo: persistence.briefRepo,
          llmProvider
        };

        const publishDeps: PublishEvidenceBundleDeps = {
          clock: runtime.clock,
          http: runtime.http,
          env: runtime.env,
          bundleRepo: persistence.bundleRepo,
          briefRepo: persistence.briefRepo,
          publishAttemptRepo: persistence.publishAttemptRepo,
          contract,
          retry: runtime.retryControl
        };

        return {
          connection: persistence.connection,
          services: {
            collect: (context) => runCoreCollectionJob(coreDeps, context),
            derive: (request) => deriveMvpFeatures(deriveDeps, request),
            assemble: (request) => assembleEvidenceBundle(assembleDeps, request),
            generateBrief: (request) => generateResearchBrief(briefDeps, request),
            publish: (request) => publishEvidenceBundle(publishDeps, request)
          }
        };
      } catch (error) {
        await persistence.connection.close();
        throw error;
      }
    }
  });

  const result = await job(config);

  console.log(JSON.stringify(result, secretRedactingReplacer));

  const isSuccessExit =
    result.status === "complete" ||
    result.status === "degraded" ||
    result.status === "skipped_already_running";

  process.exitCode = isSuccessExit ? 0 : 1;
}

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  try {
    await runCoreEvidencePipelineScript(runtime);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    console.error(redactSecretMentions(rawMsg));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
