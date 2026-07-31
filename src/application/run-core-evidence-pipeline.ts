import type {
  CollectionRunContext,
  CoreCollectionResult,
  CoreCollectionStatus
} from "../contracts/collection-run.js";
import type { CoreEvidencePipelineConfig } from "./load-core-evidence-pipeline-config.js";
import type { DeriveMvpFeaturesRequest, DeriveMvpFeaturesResult } from "./derive-mvp-features.js";
import type {
  AssembleEvidenceBundleRequest,
  AssembleEvidenceBundleResult
} from "./assemble-evidence-bundle.js";
import type {
  GenerateResearchBriefParams,
  GenerateResearchBriefOutcome
} from "./generate-research-brief.js";
import type {
  PublishEvidenceBundleRequest,
  PublishEvidenceBundleResult
} from "./publish-evidence-bundle.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";
import type { PipelineRunLock } from "../ports/pipeline-run-lock.js";
import type { DbConnection } from "../ports/db.js";
import { redactSecretMentions } from "../domain/redact-secrets.js";
import { MVP_ACCEPTED_CALCULATOR_VERSIONS } from "../domain/derived-feature/constants.js";
import { EVIDENCE_BUNDLE_SELECTION_VERSION } from "../domain/evidence-bundle/select.js";
import {
  buildPositionCorrelationId,
  evaluatePositionFeatureGate,
  aggregatePipelineStatus,
  type PositionPipelineStatus,
  type CoreEvidencePipelineStatus
} from "./core-evidence-pipeline-policy.js";

export interface CoreEvidencePipelineServices {
  readonly collect: (context: CollectionRunContext) => Promise<CoreCollectionResult>;
  readonly derive: (request: DeriveMvpFeaturesRequest) => Promise<DeriveMvpFeaturesResult>;
  readonly assemble: (
    request: AssembleEvidenceBundleRequest
  ) => Promise<AssembleEvidenceBundleResult>;
  readonly generateBrief: (
    request: GenerateResearchBriefParams
  ) => Promise<GenerateResearchBriefOutcome>;
  readonly publish: (request: PublishEvidenceBundleRequest) => Promise<PublishEvidenceBundleResult>;
}

export interface CoreEvidencePipelineResources {
  readonly connection: DbConnection;
  readonly services: CoreEvidencePipelineServices;
}

export interface RunCoreEvidencePipelineDeps {
  readonly clock: Clock;
  readonly runIdFactory: RunIdFactory;
  readonly lock: PipelineRunLock;
  readonly openResources: () => Promise<CoreEvidencePipelineResources>;
}

export interface PipelineDiagnostic {
  readonly stage: string;
  readonly code: string;
  readonly message: string;
}

export interface PositionPipelineResult {
  readonly positionId: string;
  readonly correlationId: string;
  readonly bundleId: number | null;
  readonly assemblyOutcome: string | null;
  readonly briefOutcome: string | null;
  readonly publishOutcome: string | null;
  readonly status: PositionPipelineStatus;
  readonly warnings: readonly string[];
  readonly diagnostic: PipelineDiagnostic | null;
}

export interface CoreEvidencePipelineResult {
  readonly pipelineRunId: string;
  readonly collectionStartedAtUnixMs: number;
  readonly evaluationTimeUnixMs: number | null;
  readonly collectionStatus: CoreCollectionStatus | null;
  readonly positions: readonly PositionPipelineResult[];
  readonly status: CoreEvidencePipelineStatus;
  readonly warnings: readonly string[];
  readonly diagnostics: readonly PipelineDiagnostic[];
  readonly cleanupErrors: readonly PipelineDiagnostic[];
}

const LOCK_KEY = "core-evidence-pipeline:SOL/USDC";

export async function runCoreEvidencePipeline(
  deps: RunCoreEvidencePipelineDeps,
  config: CoreEvidencePipelineConfig
): Promise<CoreEvidencePipelineResult> {
  const pipelineRunId = deps.runIdFactory.nextRunId();
  const collectionStartedAtUnixMs = new Date(deps.clock.now()).getTime();

  let lockAcquired = false;
  try {
    const lockOutcome = await deps.lock.acquire(LOCK_KEY);
    if (lockOutcome === "already_running") {
      return {
        pipelineRunId,
        collectionStartedAtUnixMs,
        evaluationTimeUnixMs: null,
        collectionStatus: null,
        positions: [],
        status: "skipped_already_running",
        warnings: [],
        diagnostics: [],
        cleanupErrors: []
      };
    }
    lockAcquired = true;
  } catch (err) {
    return {
      pipelineRunId,
      collectionStartedAtUnixMs,
      evaluationTimeUnixMs: null,
      collectionStatus: null,
      positions: [],
      status: "failed",
      warnings: [],
      diagnostics: [
        {
          stage: "lock_acquire",
          code: "LOCK_ACQUIRE_FAILED",
          message: redactSecretMentions(err instanceof Error ? err.message : String(err))
        }
      ],
      cleanupErrors: []
    };
  }

  let resources: CoreEvidencePipelineResources | null = null;
  let evaluationTimeUnixMs: number | null = null;
  let collectionStatus: CoreCollectionStatus | null = null;
  const positions: PositionPipelineResult[] = [];
  let status: CoreEvidencePipelineStatus = "failed";
  const sharedWarnings: string[] = [];
  const diagnostics: PipelineDiagnostic[] = [];
  const cleanupErrors: PipelineDiagnostic[] = [];

  try {
    let openSuccess = false;
    try {
      resources = await deps.openResources();
      openSuccess = true;
    } catch (err) {
      diagnostics.push({
        stage: "open_resources",
        code: "RESOURCE_OPEN_FAILED",
        message: redactSecretMentions(err instanceof Error ? err.message : String(err))
      });
      status = "failed";
    }

    if (openSuccess && resources) {
      const collectionContext: CollectionRunContext = {
        runId: pipelineRunId,
        startedAtUnixMs: collectionStartedAtUnixMs
      };

      let collectSuccess = false;
      let collectionResult: CoreCollectionResult | null = null;
      try {
        collectionResult = await resources.services.collect(collectionContext);
        collectSuccess = true;
      } catch (err) {
        diagnostics.push({
          stage: "collection",
          code: "COLLECTION_FAILED",
          message: redactSecretMentions(err instanceof Error ? err.message : String(err))
        });
        status = "failed";
      }

      if (collectSuccess && collectionResult) {
        collectionStatus = collectionResult.status;
        evaluationTimeUnixMs = new Date(deps.clock.now()).getTime();

        for (const w of collectionResult.warnings) {
          const formatted = w.message
            ? `${w.source}:${w.code}: ${w.message}`
            : `${w.source}:${w.code}`;
          sharedWarnings.push(redactSecretMentions(formatted));
        }

        if (collectionStatus === "UNAVAILABLE" || collectionStatus === "FAILED") {
          status = "failed";
        } else {
          let deriveSuccess = false;
          let deriveResult: DeriveMvpFeaturesResult | null = null;
          try {
            deriveResult = await resources.services.derive({
              pair: "SOL/USDC",
              poolId: config.poolId,
              positionIds: config.positionIds,
              pipelineRunId,
              evaluationTimeUnixMs,
              codeVersion: config.codeVersion
            });
            deriveSuccess = true;
          } catch (err) {
            diagnostics.push({
              stage: "derivation",
              code: "DERIVATION_FAILED",
              message: redactSecretMentions(err instanceof Error ? err.message : String(err))
            });
            status = "failed";
          }

          if (deriveSuccess && deriveResult) {
            for (const w of deriveResult.warnings) {
              sharedWarnings.push(redactSecretMentions(w));
            }

            const derivedRows = deriveResult.rows;

            for (const positionId of config.positionIds) {
              const correlationId = buildPositionCorrelationId(pipelineRunId, positionId);

              const gate = evaluatePositionFeatureGate({
                rows: derivedRows.filter((r) => !r.positionId || r.positionId === positionId),
                poolId: config.poolId,
                positionId,
                evaluationTimeUnixMs
              });

              if (!gate.usable) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: null,
                  briefOutcome: null,
                  publishOutcome: null,
                  status: "failed",
                  warnings: gate.reasons,
                  diagnostic: {
                    stage: "position_gate",
                    code: "GATE_FAILED",
                    message: redactSecretMentions(
                      `Position feature gate failed: ${gate.reasons.join(", ")}`
                    )
                  }
                });
                continue;
              }

              const createdAtUnixMs = new Date(deps.clock.now()).getTime();
              const assemblyReq: AssembleEvidenceBundleRequest = {
                pair: "SOL/USDC",
                poolId: config.poolId,
                positionId,
                walletId: config.walletId,
                pipelineRunId,
                correlationId,
                evaluationTimeUnixMs,
                createdAtUnixMs,
                acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
                schemaVersion: "evidence-bundle.v1",
                assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
                codeVersion: config.codeVersion,
                gitCommit: config.gitCommit,
                environment: config.environment
              };

              let assembly: AssembleEvidenceBundleResult;
              try {
                assembly = await resources.services.assemble(assemblyReq);
              } catch (err) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: "error",
                  briefOutcome: null,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                });
                continue;
              }

              const assemblyOutcomeStr = "outcome" in assembly ? assembly.outcome : assembly.code;
              const isAssemblySuccess =
                "outcome" in assembly &&
                (assembly.outcome === "persisted" || assembly.outcome === "identical_replay");

              if (!isAssemblySuccess || !("rowId" in assembly)) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: null,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(
                      `Assembly failed with outcome: ${assemblyOutcomeStr}`
                    )
                  }
                });
                continue;
              }

              const bundleId = assembly.rowId;
              const assemblyWarnings =
                "warnings" in assembly && Array.isArray(assembly.warnings)
                  ? assembly.warnings.map(redactSecretMentions)
                  : [];

              let brief: GenerateResearchBriefOutcome;
              try {
                brief = await resources.services.generateBrief({
                  evidenceBundleId: bundleId,
                  pair: "SOL/USDC",
                  evaluationTimeUnixMs,
                  codeVersion: config.codeVersion,
                  runId: pipelineRunId
                });
              } catch (err) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: "error",
                  publishOutcome: null,
                  status: "failed",
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: {
                    stage: "brief",
                    code: "BRIEF_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                });
                continue;
              }

              const briefOutcomeStr = brief.outcome;
              if (brief.outcome === "no_brief") {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: null,
                  status: "failed",
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: {
                    stage: "brief",
                    code: "NO_BRIEF",
                    message: redactSecretMentions(
                      `Brief generation returned no_brief (${brief.reason})`
                    )
                  }
                });
                continue;
              }

              let publication: PublishEvidenceBundleResult;
              try {
                publication = await resources.services.publish({ evidenceBundleId: bundleId });
              } catch (err) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: "error",
                  status: "failed",
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: {
                    stage: "publish",
                    code: "PUBLISH_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                });
                continue;
              }

              const publishOutcomeStr = publication.outcome;
              const isPublishSuccess =
                publication.outcome === "created" ||
                publication.outcome === "created_degraded" ||
                publication.outcome === "idempotent_replay";

              if (!isPublishSuccess) {
                positions.push({
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: publishOutcomeStr,
                  status: "failed",
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: {
                    stage: "publish",
                    code: "PUBLISH_FAILED",
                    message: redactSecretMentions(
                      `Publish failed with outcome: ${publishOutcomeStr}`
                    )
                  }
                });
                continue;
              }

              const isPositionDegraded =
                collectionStatus === "PARTIAL" ||
                brief.outcome === "generated_degraded" ||
                publication.outcome === "created_degraded";
              const positionStatus: PositionPipelineStatus = isPositionDegraded
                ? "degraded"
                : "complete";

              positions.push({
                positionId,
                correlationId,
                bundleId,
                assemblyOutcome: assemblyOutcomeStr,
                briefOutcome: briefOutcomeStr,
                publishOutcome: publishOutcomeStr,
                status: positionStatus,
                warnings: Object.freeze(assemblyWarnings),
                diagnostic: null
              });
            }

            status = aggregatePipelineStatus(collectionStatus as "COMPLETE" | "PARTIAL", positions);
          }
        }
      }
    }
  } finally {
    if (resources) {
      try {
        await resources.connection.close();
      } catch (err) {
        cleanupErrors.push({
          stage: "cleanup_close",
          code: "CLOSE_FAILED",
          message: redactSecretMentions(err instanceof Error ? err.message : String(err))
        });
      }
    }
    if (lockAcquired) {
      try {
        await deps.lock.release();
      } catch (err) {
        cleanupErrors.push({
          stage: "cleanup_release",
          code: "RELEASE_FAILED",
          message: redactSecretMentions(err instanceof Error ? err.message : String(err))
        });
      }
    }
  }

  return {
    pipelineRunId,
    collectionStartedAtUnixMs,
    evaluationTimeUnixMs,
    collectionStatus,
    positions: Object.freeze([...positions]),
    status: cleanupErrors.length > 0 ? "failed" : status,
    warnings: Object.freeze([...sharedWarnings]),
    diagnostics: Object.freeze([...diagnostics]),
    cleanupErrors: Object.freeze([...cleanupErrors])
  };
}
