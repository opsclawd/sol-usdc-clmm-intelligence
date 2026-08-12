import type { PersistedResearchBrief } from "../contracts/research-brief.js";
import type { ResearchBriefRow } from "../ports/brief-repo.js";
import type {
  CollectionRunContext,
  CoreCollectionResult,
  CoreCollectionStatus
} from "../contracts/collection-run.js";
import type { CoreEvidencePipelineConfig } from "./load-core-evidence-pipeline-config.js";
import type { DeriveMvpFeaturesRequest, DeriveMvpFeaturesResult } from "./derive-mvp-features.js";
import type {
  AssembleEvidenceBundleRequest,
  AssembleEvidenceBundleResult,
  PreparedEvidenceBundle,
  PrepareEvidenceBundleResult
} from "./assemble-evidence-bundle.js";
import type {
  AssemblePairEvidenceBundleRequest,
  AssemblePairEvidenceBundleResult,
  PreparedPairEvidenceBundle,
  PreparePairEvidenceBundleResult
} from "./assemble-pair-evidence-bundle.js";
import type {
  GenerateResearchBriefParams,
  GenerateResearchBriefOutcome,
  PersistResearchBriefParams
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
  buildPairCorrelationId,
  evaluatePositionFeatureGate,
  aggregatePipelineStatus,
  type PositionPipelineStatus,
  type CoreEvidencePipelineStatus
} from "./core-evidence-pipeline-policy.js";

export interface CoreEvidencePipelineServices {
  readonly collect: (context: CollectionRunContext) => Promise<CoreCollectionResult>;
  readonly derive: (request: DeriveMvpFeaturesRequest) => Promise<DeriveMvpFeaturesResult>;
  readonly prepare: (
    request: AssembleEvidenceBundleRequest
  ) => Promise<PrepareEvidenceBundleResult>;
  readonly finalize: (
    prepared: PreparedEvidenceBundle,
    brief?: PersistedResearchBrief
  ) => Promise<AssembleEvidenceBundleResult>;
  readonly preparePair: (
    request: AssemblePairEvidenceBundleRequest
  ) => Promise<PreparePairEvidenceBundleResult>;
  readonly finalizePair: (
    prepared: PreparedPairEvidenceBundle,
    brief?: PersistedResearchBrief
  ) => Promise<AssemblePairEvidenceBundleResult>;
  readonly generateBrief: (
    request: GenerateResearchBriefParams
  ) => Promise<GenerateResearchBriefOutcome>;
  readonly persistBrief: (params: PersistResearchBriefParams) => Promise<ResearchBriefRow>;
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

export interface PairPipelineResult {
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
  readonly pair: PairPipelineResult | null;
  readonly positions: readonly PositionPipelineResult[];
  readonly status: CoreEvidencePipelineStatus;
  readonly warnings: readonly string[];
  readonly diagnostics: readonly PipelineDiagnostic[];
  readonly cleanupErrors: readonly PipelineDiagnostic[];
}

const LOCK_KEY = "core-evidence-pipeline:SOL/USDC";

function formatReportedCollectionFailure(result: CoreCollectionResult): string {
  const sourceOutcomes = [
    result.clmmV2,
    result.pyth,
    result.jupiter,
    result.orca,
    result.solana
  ].map((outcome) => ({
    sourceKey: outcome.sourceKey,
    status: outcome.status,
    hasUsableEvidence: outcome.hasUsableEvidence,
    diagnostic: outcome.diagnostic ? redactSecretMentions(outcome.diagnostic) : null
  }));

  return redactSecretMentions(
    `Collection reported ${result.status}: ${JSON.stringify(sourceOutcomes)}`
  );
}

// Bounds how many positions are processed concurrently so the cron job
// doesn't serialize dozens of sequential LLM round-trips (risking timeout)
// while still respecting per-provider rate limits.
const POSITION_PROCESSING_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      const item = items[currentIndex] as T;
      results[currentIndex] = await fn(item);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

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
        pair: null,
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
      pair: null,
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
  let pairResult: PairPipelineResult | null = null;
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

        if (collectionResult.shouldFailCommand) {
          diagnostics.push({
            stage: "collection",
            code: `COLLECTION_REPORTED_${collectionStatus}`,
            message: formatReportedCollectionFailure(collectionResult)
          });
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

            const pairCorrelationId = buildPairCorrelationId(pipelineRunId);
            const pairCreatedAtUnixMs = new Date(deps.clock.now()).getTime();
            const pairAssemblyReq: AssemblePairEvidenceBundleRequest = {
              pair: "SOL/USDC",
              poolId: config.poolId,
              pipelineRunId,
              correlationId: pairCorrelationId,
              evaluationTimeUnixMs,
              createdAtUnixMs: pairCreatedAtUnixMs,
              acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
              schemaVersion: "evidence-bundle.v1",
              assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
              codeVersion: config.codeVersion,
              gitCommit: config.gitCommit,
              environment: config.environment,
              configuredFamilies: config.configuredFamilies
            };

            let prep: PreparePairEvidenceBundleResult | null = null;
            try {
              prep = await resources.services.preparePair(pairAssemblyReq);
            } catch (err) {
              pairResult = {
                correlationId: pairCorrelationId,
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
              };
            }
            if (!pairResult && prep) {
              if (!("outcome" in prep)) {
                const assemblyOutcomeStr = prep.code;
                pairResult = {
                  correlationId: pairCorrelationId,
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
                      "message" in prep
                        ? prep.message
                        : `Assembly failed with error code: ${prep.code}`
                    )
                  }
                };
              } else if (prep.outcome === "identical_replay") {
                const bundleId = prep.rowId;
                const assemblyWarnings = Array.isArray(prep.warnings)
                  ? prep.warnings.map(redactSecretMentions)
                  : [];
                let briefArtifact = prep.embeddedBrief ?? null;
                let briefPriorRowId: number | undefined;
                let briefOutcomeStr: string | null = briefArtifact ? "reused" : null;

                if (!briefArtifact && prep.prepared) {
                  let pairBrief: GenerateResearchBriefOutcome | null = null;
                  try {
                    pairBrief = await resources.services.generateBrief({
                      evidenceBundlePayload: prep.prepared.nullBriefCandidate,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId
                    });
                  } catch (err) {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
                      briefOutcome: "error",
                      publishOutcome: null,
                      status: "failed",
                      warnings: Object.freeze(assemblyWarnings),
                      diagnostic: {
                        stage: "brief",
                        code: "BRIEF_FAILED",
                        message: redactSecretMentions(
                          err instanceof Error ? err.message : String(err)
                        )
                      }
                    };
                  }
                  if (!pairResult && pairBrief) {
                    briefOutcomeStr = pairBrief.outcome;
                    if (pairBrief.outcome === "no_brief") {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId,
                        assemblyOutcome: prep.outcome,
                        briefOutcome: briefOutcomeStr,
                        publishOutcome: null,
                        status: "failed",
                        warnings: Object.freeze(assemblyWarnings),
                        diagnostic: {
                          stage: "brief",
                          code: "NO_BRIEF",
                          message: redactSecretMentions(
                            `Brief generation returned no_brief (${pairBrief.reason})`
                          )
                        }
                      };
                    } else {
                      briefArtifact = pairBrief.brief;
                      briefPriorRowId =
                        "priorBriefRowId" in pairBrief ? pairBrief.priorBriefRowId : undefined;
                    }
                  }
                }

                if (!pairResult && briefArtifact) {
                  try {
                    await resources.services.persistBrief({
                      bundleId,
                      bundleHash: prep.payloadHash,
                      brief: briefArtifact,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId,
                      expiresAtUnixMs: evaluationTimeUnixMs + 3600000,
                      ...(briefPriorRowId !== undefined ? { priorBriefRowId: briefPriorRowId } : {})
                    });
                  } catch (err) {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
                      briefOutcome: "error",
                      publishOutcome: null,
                      status: "failed",
                      warnings: Object.freeze(assemblyWarnings),
                      diagnostic: {
                        stage: "brief",
                        code: "BRIEF_FAILED",
                        message: redactSecretMentions(
                          err instanceof Error ? err.message : String(err)
                        )
                      }
                    };
                  }
                }

                if (!pairResult) {
                  let pairPub: PublishEvidenceBundleResult | null = null;
                  try {
                    pairPub = await resources.services.publish({
                      evidenceBundleId: bundleId
                    });
                  } catch (err) {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
                      briefOutcome: briefOutcomeStr,
                      publishOutcome: "error",
                      status: "failed",
                      warnings: Object.freeze(assemblyWarnings),
                      diagnostic: {
                        stage: "publish",
                        code: "PUBLISH_FAILED",
                        message: redactSecretMentions(
                          err instanceof Error ? err.message : String(err)
                        )
                      }
                    };
                  }
                  if (!pairResult && pairPub) {
                    const publishOutcomeStr = pairPub.outcome;
                    const isPublishSuccess =
                      pairPub.outcome === "created" ||
                      pairPub.outcome === "created_degraded" ||
                      pairPub.outcome === "idempotent_replay";
                    if (!isPublishSuccess) {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId,
                        assemblyOutcome: prep.outcome,
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
                      };
                    } else {
                      const isPairDegraded =
                        collectionStatus === "PARTIAL" ||
                        briefOutcomeStr === "generated_degraded" ||
                        pairPub.outcome === "created_degraded" ||
                        !briefArtifact;
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId,
                        assemblyOutcome: prep.outcome,
                        briefOutcome: briefOutcomeStr,
                        publishOutcome: publishOutcomeStr,
                        status: isPairDegraded ? "degraded" : "complete",
                        warnings: Object.freeze(assemblyWarnings),
                        diagnostic: null
                      };
                    }
                  }
                }
              } else if (prep.outcome !== "prepared") {
                pairResult = {
                  correlationId: pairCorrelationId,
                  bundleId: null,
                  assemblyOutcome: prep.outcome,
                  briefOutcome: null,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(`Assembly failed with outcome: ${prep.outcome}`)
                  }
                };
              } else {
                const preparedPayload = prep.prepared;
                let pairBrief: GenerateResearchBriefOutcome | null = null;
                try {
                  pairBrief = await resources.services.generateBrief({
                    evidenceBundlePayload: preparedPayload.nullBriefCandidate,
                    pair: "SOL/USDC",
                    evaluationTimeUnixMs,
                    codeVersion: config.codeVersion,
                    runId: pipelineRunId
                  });
                } catch (err) {
                  pairResult = {
                    correlationId: pairCorrelationId,
                    bundleId: null,
                    assemblyOutcome: "prepared",
                    briefOutcome: "error",
                    publishOutcome: null,
                    status: "failed",
                    warnings: [],
                    diagnostic: {
                      stage: "brief",
                      code: "BRIEF_FAILED",
                      message: redactSecretMentions(
                        err instanceof Error ? err.message : String(err)
                      )
                    }
                  };
                }
                if (!pairResult && pairBrief) {
                  const briefOutcomeStr = pairBrief.outcome;
                  if (pairBrief.outcome === "no_brief") {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId: null,
                      assemblyOutcome: "prepared",
                      briefOutcome: briefOutcomeStr,
                      publishOutcome: null,
                      status: "failed",
                      warnings: [],
                      diagnostic: {
                        stage: "brief",
                        code: "NO_BRIEF",
                        message: redactSecretMentions(
                          `Brief generation returned no_brief (${pairBrief.reason})`
                        )
                      }
                    };
                  } else {
                    const briefArtifact = pairBrief.brief;
                    const briefPriorRowId =
                      "priorBriefRowId" in pairBrief ? pairBrief.priorBriefRowId : undefined;
                    let fin: AssemblePairEvidenceBundleResult | null = null;
                    try {
                      fin = await resources.services.finalizePair(preparedPayload, briefArtifact);
                    } catch (err) {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId: null,
                        assemblyOutcome: "prepared",
                        briefOutcome: briefOutcomeStr,
                        publishOutcome: null,
                        status: "failed",
                        warnings: [],
                        diagnostic: {
                          stage: "assembly",
                          code: "ASSEMBLY_FAILED",
                          message: redactSecretMentions(
                            err instanceof Error ? err.message : String(err)
                          )
                        }
                      };
                    }
                    if (!pairResult && fin) {
                      if (!("outcome" in fin)) {
                        const finOutcomeStr = fin.code;
                        pairResult = {
                          correlationId: pairCorrelationId,
                          bundleId: null,
                          assemblyOutcome: finOutcomeStr,
                          briefOutcome: briefOutcomeStr,
                          publishOutcome: null,
                          status: "failed",
                          warnings: [],
                          diagnostic: {
                            stage: "assembly",
                            code: "ASSEMBLY_FAILED",
                            message: redactSecretMentions(
                              "message" in fin
                                ? fin.message
                                : `Finalize failed with outcome: ${fin.code}`
                            )
                          }
                        };
                      } else if (
                        fin.outcome !== "persisted" &&
                        fin.outcome !== "identical_replay"
                      ) {
                        pairResult = {
                          correlationId: pairCorrelationId,
                          bundleId: null,
                          assemblyOutcome: fin.outcome,
                          briefOutcome: briefOutcomeStr,
                          publishOutcome: null,
                          status: "failed",
                          warnings: [],
                          diagnostic: {
                            stage: "assembly",
                            code: "ASSEMBLY_FAILED",
                            message: redactSecretMentions(
                              `Finalize failed with outcome: ${fin.outcome}`
                            )
                          }
                        };
                      } else {
                        const bundleId = fin.rowId;
                        const assemblyWarnings = Array.isArray(fin.warnings)
                          ? fin.warnings.map(redactSecretMentions)
                          : [];
                        if (briefArtifact) {
                          try {
                            await resources.services.persistBrief({
                              bundleId,
                              bundleHash: fin.payloadHash,
                              brief: briefArtifact,
                              pair: "SOL/USDC",
                              evaluationTimeUnixMs,
                              codeVersion: config.codeVersion,
                              runId: pipelineRunId,
                              expiresAtUnixMs: evaluationTimeUnixMs + 3600000,
                              ...(briefPriorRowId !== undefined
                                ? { priorBriefRowId: briefPriorRowId }
                                : {})
                            });
                          } catch (err) {
                            pairResult = {
                              correlationId: pairCorrelationId,
                              bundleId,
                              assemblyOutcome: fin.outcome,
                              briefOutcome: "error",
                              publishOutcome: null,
                              status: "failed",
                              warnings: Object.freeze(assemblyWarnings),
                              diagnostic: {
                                stage: "brief",
                                code: "BRIEF_FAILED",
                                message: redactSecretMentions(
                                  err instanceof Error ? err.message : String(err)
                                )
                              }
                            };
                          }
                        }
                        if (!pairResult) {
                          let pairPub: PublishEvidenceBundleResult | null = null;
                          try {
                            pairPub = await resources.services.publish({
                              evidenceBundleId: bundleId
                            });
                          } catch (err) {
                            pairResult = {
                              correlationId: pairCorrelationId,
                              bundleId,
                              assemblyOutcome: fin.outcome,
                              briefOutcome: briefOutcomeStr,
                              publishOutcome: "error",
                              status: "failed",
                              warnings: Object.freeze(assemblyWarnings),
                              diagnostic: {
                                stage: "publish",
                                code: "PUBLISH_FAILED",
                                message: redactSecretMentions(
                                  err instanceof Error ? err.message : String(err)
                                )
                              }
                            };
                          }
                          if (!pairResult && pairPub) {
                            const publishOutcomeStr = pairPub.outcome;
                            const isPublishSuccess =
                              pairPub.outcome === "created" ||
                              pairPub.outcome === "created_degraded" ||
                              pairPub.outcome === "idempotent_replay";
                            if (!isPublishSuccess) {
                              pairResult = {
                                correlationId: pairCorrelationId,
                                bundleId,
                                assemblyOutcome: fin.outcome,
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
                              };
                            } else {
                              const isPairDegraded =
                                collectionStatus === "PARTIAL" ||
                                pairBrief.outcome === "generated_degraded" ||
                                pairPub.outcome === "created_degraded";
                              pairResult = {
                                correlationId: pairCorrelationId,
                                bundleId,
                                assemblyOutcome: fin.outcome,
                                briefOutcome: briefOutcomeStr,
                                publishOutcome: publishOutcomeStr,
                                status: isPairDegraded ? "degraded" : "complete",
                                warnings: Object.freeze(assemblyWarnings),
                                diagnostic: null
                              };
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            const derivedRows = deriveResult.rows;
            const activeResources = resources;
            const activeEvaluationTimeUnixMs = evaluationTimeUnixMs;

            const processPosition = async (positionId: string): Promise<PositionPipelineResult> => {
              const correlationId = buildPositionCorrelationId(pipelineRunId, positionId);

              const gate = evaluatePositionFeatureGate({
                rows: derivedRows.filter((r) => !r.positionId || r.positionId === positionId),
                poolId: config.poolId,
                positionId,
                evaluationTimeUnixMs: activeEvaluationTimeUnixMs
              });

              if (!gate.usable) {
                return {
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
                };
              }

              const createdAtUnixMs = new Date(deps.clock.now()).getTime();
              const assemblyReq: AssembleEvidenceBundleRequest = {
                pair: "SOL/USDC",
                poolId: config.poolId,
                positionId,
                walletId: config.walletId,
                pipelineRunId,
                correlationId,
                evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                createdAtUnixMs,
                acceptedCalculatorVersions: MVP_ACCEPTED_CALCULATOR_VERSIONS,
                schemaVersion: "evidence-bundle.v1",
                assemblySelectionVersion: EVIDENCE_BUNDLE_SELECTION_VERSION,
                codeVersion: config.codeVersion,
                gitCommit: config.gitCommit,
                environment: config.environment
              };

              let prep: PrepareEvidenceBundleResult | null = null;
              try {
                prep = await activeResources.services.prepare(assemblyReq);
              } catch (err) {
                return {
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
                };
              }
              if (!("outcome" in prep)) {
                const assemblyOutcomeStr = prep.code;
                return {
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
                      "message" in prep
                        ? prep.message
                        : `Assembly failed with error code: ${prep.code}`
                    )
                  }
                };
              } else if (prep.outcome === "identical_replay") {
                const bundleId = prep.rowId;
                const assemblyWarnings = Array.isArray(prep.warnings)
                  ? prep.warnings.map(redactSecretMentions)
                  : [];
                let briefArtifact = prep.embeddedBrief ?? null;
                let briefPriorRowId: number | undefined;
                let briefOutcomeStr: string | null = briefArtifact ? "reused" : null;

                if (!briefArtifact && prep.prepared) {
                  let brief: GenerateResearchBriefOutcome | null = null;
                  try {
                    brief = await activeResources.services.generateBrief({
                      evidenceBundlePayload: prep.prepared.nullBriefCandidate,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId
                    });
                  } catch (err) {
                    return {
                      positionId,
                      correlationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
                      briefOutcome: "error",
                      publishOutcome: null,
                      status: "failed",
                      warnings: Object.freeze(assemblyWarnings),
                      diagnostic: {
                        stage: "brief",
                        code: "BRIEF_FAILED",
                        message: redactSecretMentions(
                          err instanceof Error ? err.message : String(err)
                        )
                      }
                    };
                  }

                  briefOutcomeStr = brief.outcome;
                  if (brief.outcome === "no_brief") {
                    return {
                      positionId,
                      correlationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
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
                    };
                  }
                  briefArtifact = brief.brief;
                  briefPriorRowId = "priorBriefRowId" in brief ? brief.priorBriefRowId : undefined;
                }

                if (briefArtifact) {
                  try {
                    await activeResources.services.persistBrief({
                      bundleId,
                      bundleHash: prep.payloadHash,
                      brief: briefArtifact,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId,
                      expiresAtUnixMs: activeEvaluationTimeUnixMs + 3600000,
                      ...(briefPriorRowId !== undefined ? { priorBriefRowId: briefPriorRowId } : {})
                    });
                  } catch (err) {
                    return {
                      positionId,
                      correlationId,
                      bundleId,
                      assemblyOutcome: prep.outcome,
                      briefOutcome: "error",
                      publishOutcome: null,
                      status: "failed",
                      warnings: Object.freeze(assemblyWarnings),
                      diagnostic: {
                        stage: "brief",
                        code: "BRIEF_FAILED",
                        message: redactSecretMentions(
                          err instanceof Error ? err.message : String(err)
                        )
                      }
                    };
                  }
                }

                let publication: PublishEvidenceBundleResult;
                try {
                  publication = await activeResources.services.publish({
                    evidenceBundleId: bundleId
                  });
                } catch (err) {
                  return {
                    positionId,
                    correlationId,
                    bundleId,
                    assemblyOutcome: prep.outcome,
                    briefOutcome: briefOutcomeStr,
                    publishOutcome: "error",
                    status: "failed",
                    warnings: Object.freeze(assemblyWarnings),
                    diagnostic: {
                      stage: "publish",
                      code: "PUBLISH_FAILED",
                      message: redactSecretMentions(
                        err instanceof Error ? err.message : String(err)
                      )
                    }
                  };
                }
                const publishOutcomeStr = publication.outcome;
                const isPublishSuccess =
                  publication.outcome === "created" ||
                  publication.outcome === "created_degraded" ||
                  publication.outcome === "idempotent_replay";

                if (!isPublishSuccess) {
                  return {
                    positionId,
                    correlationId,
                    bundleId,
                    assemblyOutcome: prep.outcome,
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
                  };
                }

                const isPositionDegraded =
                  collectionStatus === "PARTIAL" ||
                  briefOutcomeStr === "generated_degraded" ||
                  publication.outcome === "created_degraded" ||
                  !briefArtifact;
                const positionStatus: PositionPipelineStatus = isPositionDegraded
                  ? "degraded"
                  : "complete";

                return {
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: prep.outcome,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: publishOutcomeStr,
                  status: positionStatus,
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: null
                };
              } else if (prep.outcome !== "prepared") {
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: prep.outcome,
                  briefOutcome: null,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(`Assembly failed with outcome: ${prep.outcome}`)
                  }
                };
              }

              const preparedPayload = prep.prepared;
              let brief: GenerateResearchBriefOutcome | null = null;
              try {
                brief = await activeResources.services.generateBrief({
                  evidenceBundlePayload: preparedPayload.nullBriefCandidate,
                  pair: "SOL/USDC",
                  evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                  codeVersion: config.codeVersion,
                  runId: pipelineRunId
                });
              } catch (err) {
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: "prepared",
                  briefOutcome: "error",
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "brief",
                    code: "BRIEF_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                };
              }

              const briefOutcomeStr = brief.outcome;
              if (brief.outcome === "no_brief") {
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: "prepared",
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "brief",
                    code: "NO_BRIEF",
                    message: redactSecretMentions(
                      `Brief generation returned no_brief (${brief.reason})`
                    )
                  }
                };
              }

              const briefArtifact = brief.brief;
              const briefPriorRowId =
                "priorBriefRowId" in brief ? brief.priorBriefRowId : undefined;
              let fin: AssembleEvidenceBundleResult | null = null;
              try {
                fin = await activeResources.services.finalize(preparedPayload, briefArtifact);
              } catch (err) {
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: "prepared",
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                };
              }

              if (!("outcome" in fin)) {
                const finOutcomeStr = fin.code;
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: finOutcomeStr,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(
                      "message" in fin
                        ? fin.message
                        : `Finalize failed with error code: ${fin.code}`
                    )
                  }
                };
              } else if (fin.outcome !== "persisted" && fin.outcome !== "identical_replay") {
                return {
                  positionId,
                  correlationId,
                  bundleId: null,
                  assemblyOutcome: fin.outcome,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: null,
                  status: "failed",
                  warnings: [],
                  diagnostic: {
                    stage: "assembly",
                    code: "ASSEMBLY_FAILED",
                    message: redactSecretMentions(`Finalize failed with outcome: ${fin.outcome}`)
                  }
                };
              }

              const bundleId = fin.rowId;
              const assemblyWarnings = Array.isArray(fin.warnings)
                ? fin.warnings.map(redactSecretMentions)
                : [];

              if (briefArtifact) {
                try {
                  await activeResources.services.persistBrief({
                    bundleId,
                    bundleHash: fin.payloadHash,
                    brief: briefArtifact,
                    pair: "SOL/USDC",
                    evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                    codeVersion: config.codeVersion,
                    runId: pipelineRunId,
                    expiresAtUnixMs: activeEvaluationTimeUnixMs + 3600000,
                    ...(briefPriorRowId !== undefined ? { priorBriefRowId: briefPriorRowId } : {})
                  });
                } catch (err) {
                  return {
                    positionId,
                    correlationId,
                    bundleId,
                    assemblyOutcome: fin.outcome,
                    briefOutcome: "error",
                    publishOutcome: null,
                    status: "failed",
                    warnings: Object.freeze(assemblyWarnings),
                    diagnostic: {
                      stage: "brief",
                      code: "BRIEF_FAILED",
                      message: redactSecretMentions(
                        err instanceof Error ? err.message : String(err)
                      )
                    }
                  };
                }
              }

              let publication: PublishEvidenceBundleResult;
              try {
                publication = await activeResources.services.publish({
                  evidenceBundleId: bundleId
                });
              } catch (err) {
                return {
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: fin.outcome,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: "error",
                  status: "failed",
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: {
                    stage: "publish",
                    code: "PUBLISH_FAILED",
                    message: redactSecretMentions(err instanceof Error ? err.message : String(err))
                  }
                };
              }

              const publishOutcomeStr = publication.outcome;
              const isPublishSuccess =
                publication.outcome === "created" ||
                publication.outcome === "created_degraded" ||
                publication.outcome === "idempotent_replay";

              if (!isPublishSuccess) {
                return {
                  positionId,
                  correlationId,
                  bundleId,
                  assemblyOutcome: fin.outcome,
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
                };
              }

              const isPositionDegraded =
                collectionStatus === "PARTIAL" ||
                brief.outcome === "generated_degraded" ||
                publication.outcome === "created_degraded";
              const positionStatus: PositionPipelineStatus = isPositionDegraded
                ? "degraded"
                : "complete";

              return {
                positionId,
                correlationId,
                bundleId,
                assemblyOutcome: fin.outcome,
                briefOutcome: briefOutcomeStr,
                publishOutcome: publishOutcomeStr,
                status: positionStatus,
                warnings: Object.freeze(assemblyWarnings),
                diagnostic: null
              };
            };

            const positionResults = await mapWithConcurrency(
              config.positionIds,
              POSITION_PROCESSING_CONCURRENCY,
              processPosition
            );
            positions.push(...positionResults);

            const allTargets = pairResult ? [pairResult, ...positions] : positions;
            status = aggregatePipelineStatus(
              collectionStatus as "COMPLETE" | "PARTIAL",
              allTargets
            );
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
    pair: pairResult,
    positions: Object.freeze([...positions]),
    status: cleanupErrors.length > 0 ? "failed" : status,
    warnings: Object.freeze([...sharedWarnings]),
    diagnostics: Object.freeze([...diagnostics]),
    cleanupErrors: Object.freeze([...cleanupErrors])
  };
}
