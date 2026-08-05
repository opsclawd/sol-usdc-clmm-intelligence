import type { PersistedResearchBrief } from "../contracts/research-brief.js";
import type { EvidenceBundleV1 } from "../contracts/generated/evidence-bundle-v1.js";
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
  AssemblePairEvidenceBundleRequest,
  AssemblePairEvidenceBundleResult
} from "./assemble-pair-evidence-bundle.js";
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
  readonly assemble?: (
    request: AssembleEvidenceBundleRequest
  ) => Promise<AssembleEvidenceBundleResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly prepare?: (request: AssembleEvidenceBundleRequest) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly finalize?: (prepared: any, brief?: PersistedResearchBrief) => Promise<any>;
  readonly assemblePair?: (
    request: AssemblePairEvidenceBundleRequest
  ) => Promise<AssemblePairEvidenceBundleResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly preparePair?: (request: AssemblePairEvidenceBundleRequest) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly finalizePair?: (prepared: any, brief?: PersistedResearchBrief) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly generateBrief: (request: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly persistBrief?: (params: any) => Promise<any>;
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
              environment: config.environment
            };

            let pairAssembly: AssemblePairEvidenceBundleResult | null = null;
            if (resources.services.preparePair && resources.services.finalizePair) {
              let prep: Record<string, unknown> | null = null;
              try {
                prep = (await resources.services.preparePair(pairAssemblyReq)) as Record<
                  string,
                  unknown
                >;
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
                const assemblyOutcomeStr =
                  typeof prep.outcome === "string" ? prep.outcome : String(prep.code ?? "error");
                if (prep.outcome === "persisted" || prep.outcome === "identical_replay") {
                  const bundleId = prep.rowId as number;
                  const assemblyWarnings = Array.isArray(prep.warnings)
                    ? (prep.warnings as string[]).map(redactSecretMentions)
                    : [];
                  const briefArtifact = prep.embeddedBrief ?? null;
                  const briefOutcomeStr = briefArtifact ? "reused" : null;
                  if (resources.services.persistBrief && briefArtifact) {
                    try {
                      await resources.services.persistBrief({
                        bundleId,
                        bundleHash: prep.payloadHash as string,
                        brief: briefArtifact as PersistedResearchBrief,
                        pair: "SOL/USDC",
                        evaluationTimeUnixMs,
                        codeVersion: config.codeVersion,
                        runId: pipelineRunId,
                        expiresAtUnixMs: evaluationTimeUnixMs + 3600000
                      });
                    } catch (err) {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId,
                        assemblyOutcome: assemblyOutcomeStr,
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
                    let pairPub: Record<string, unknown> | null = null;
                    try {
                      pairPub = (await resources.services.publish({
                        evidenceBundleId: bundleId
                      })) as Record<string, unknown>;
                    } catch (err) {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId,
                        assemblyOutcome: assemblyOutcomeStr,
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
                      const publishOutcomeStr = pairPub.outcome as string;
                      const isPublishSuccess =
                        pairPub.outcome === "created" ||
                        pairPub.outcome === "created_degraded" ||
                        pairPub.outcome === "idempotent_replay";
                      if (!isPublishSuccess) {
                        pairResult = {
                          correlationId: pairCorrelationId,
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
                        };
                      } else {
                        const isPairDegraded =
                          collectionStatus === "PARTIAL" || pairPub.outcome === "created_degraded";
                        pairResult = {
                          correlationId: pairCorrelationId,
                          bundleId,
                          assemblyOutcome: assemblyOutcomeStr,
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
                  };
                } else {
                  const preparedPayload = prep.prepared;
                  let pairBrief: Record<string, unknown> | null = null;
                  try {
                    pairBrief = (await resources.services.generateBrief({
                      evidenceBundlePayload: preparedPayload as EvidenceBundleV1,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId
                    })) as Record<string, unknown>;
                  } catch (err) {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId: null,
                      assemblyOutcome: assemblyOutcomeStr,
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
                    const briefOutcomeStr = pairBrief.outcome as string;
                    if (pairBrief.outcome === "no_brief") {
                      pairResult = {
                        correlationId: pairCorrelationId,
                        bundleId: null,
                        assemblyOutcome: assemblyOutcomeStr,
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
                      let fin: Record<string, unknown> | null = null;
                      try {
                        fin = (await resources.services.finalizePair(
                          preparedPayload,
                          briefArtifact as PersistedResearchBrief
                        )) as Record<string, unknown>;
                      } catch (err) {
                        pairResult = {
                          correlationId: pairCorrelationId,
                          bundleId: null,
                          assemblyOutcome: assemblyOutcomeStr,
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
                        const finOutcomeStr =
                          typeof fin.outcome === "string"
                            ? fin.outcome
                            : String(fin.code ?? "error");
                        const isFinSuccess =
                          fin.outcome === "persisted" || fin.outcome === "identical_replay";
                        if (!isFinSuccess || !("rowId" in fin)) {
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
                                `Finalize failed with outcome: ${finOutcomeStr}`
                              )
                            }
                          };
                        } else {
                          const bundleId = fin.rowId as number;
                          const assemblyWarnings = Array.isArray(fin.warnings)
                            ? (fin.warnings as string[]).map(redactSecretMentions)
                            : [];
                          if (resources.services.persistBrief && briefArtifact) {
                            try {
                              await resources.services.persistBrief({
                                bundleId,
                                bundleHash: fin.payloadHash as string,
                                brief: briefArtifact as PersistedResearchBrief,
                                pair: "SOL/USDC",
                                evaluationTimeUnixMs,
                                codeVersion: config.codeVersion,
                                runId: pipelineRunId,
                                expiresAtUnixMs: evaluationTimeUnixMs + 3600000
                              });
                            } catch (err) {
                              pairResult = {
                                correlationId: pairCorrelationId,
                                bundleId,
                                assemblyOutcome: assemblyOutcomeStr,
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
                            let pairPub: Record<string, unknown> | null = null;
                            try {
                              pairPub = (await resources.services.publish({
                                evidenceBundleId: bundleId
                              })) as Record<string, unknown>;
                            } catch (err) {
                              pairResult = {
                                correlationId: pairCorrelationId,
                                bundleId,
                                assemblyOutcome: assemblyOutcomeStr,
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
                              const publishOutcomeStr = pairPub.outcome as string;
                              const isPublishSuccess =
                                pairPub.outcome === "created" ||
                                pairPub.outcome === "created_degraded" ||
                                pairPub.outcome === "idempotent_replay";
                              if (!isPublishSuccess) {
                                pairResult = {
                                  correlationId: pairCorrelationId,
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
                                };
                              } else {
                                const isPairDegraded =
                                  collectionStatus === "PARTIAL" ||
                                  pairBrief.outcome === "generated_degraded" ||
                                  pairPub.outcome === "created_degraded";
                                pairResult = {
                                  correlationId: pairCorrelationId,
                                  bundleId,
                                  assemblyOutcome: assemblyOutcomeStr,
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
            } else {
              try {
                if (!resources.services.assemblePair) {
                  throw new Error(
                    "CoreEvidencePipelineServices: missing assemblePair or preparePair service"
                  );
                }
                pairAssembly = await resources.services.assemblePair(pairAssemblyReq);
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

              if (!pairResult && pairAssembly) {
                const assemblyOutcomeStr =
                  "outcome" in pairAssembly ? pairAssembly.outcome : pairAssembly.code;
                const isAssemblySuccess =
                  "outcome" in pairAssembly &&
                  (pairAssembly.outcome === "persisted" ||
                    pairAssembly.outcome === "identical_replay");

                if (!isAssemblySuccess || !("rowId" in pairAssembly)) {
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
                        `Assembly failed with outcome: ${assemblyOutcomeStr}`
                      )
                    }
                  };
                } else {
                  const bundleId = pairAssembly.rowId;
                  const assemblyWarnings =
                    "warnings" in pairAssembly && Array.isArray(pairAssembly.warnings)
                      ? pairAssembly.warnings.map(redactSecretMentions)
                      : [];

                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  let pairBrief: any = null;
                  try {
                    pairBrief = await resources.services.generateBrief({
                      evidenceBundleId: bundleId,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId
                    });
                  } catch (err) {
                    pairResult = {
                      correlationId: pairCorrelationId,
                      bundleId,
                      assemblyOutcome: assemblyOutcomeStr,
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
                    const briefOutcomeStr = pairBrief.outcome;
                    if (pairBrief.outcome === "no_brief") {
                      pairResult = {
                        correlationId: pairCorrelationId,
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
                            `Brief generation returned no_brief (${pairBrief.reason})`
                          )
                        }
                      };
                    } else {
                      let pairPublication: PublishEvidenceBundleResult | null = null;
                      try {
                        pairPublication = await resources.services.publish({
                          evidenceBundleId: bundleId
                        });
                      } catch (err) {
                        pairResult = {
                          correlationId: pairCorrelationId,
                          bundleId,
                          assemblyOutcome: assemblyOutcomeStr,
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

                      if (!pairResult && pairPublication) {
                        const publishOutcomeStr = pairPublication.outcome;
                        const isPublishSuccess =
                          pairPublication.outcome === "created" ||
                          pairPublication.outcome === "created_degraded" ||
                          pairPublication.outcome === "idempotent_replay";

                        if (!isPublishSuccess) {
                          pairResult = {
                            correlationId: pairCorrelationId,
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
                          };
                        } else {
                          const isPairDegraded =
                            collectionStatus === "PARTIAL" ||
                            pairBrief.outcome === "generated_degraded" ||
                            pairPublication.outcome === "created_degraded";
                          const pairStatus: PositionPipelineStatus = isPairDegraded
                            ? "degraded"
                            : "complete";

                          pairResult = {
                            correlationId: pairCorrelationId,
                            bundleId,
                            assemblyOutcome: assemblyOutcomeStr,
                            briefOutcome: briefOutcomeStr,
                            publishOutcome: publishOutcomeStr,
                            status: pairStatus,
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

              let assembly: AssembleEvidenceBundleResult;
              if (activeResources.services.prepare && activeResources.services.finalize) {
                let prep: Record<string, unknown> | null = null;
                try {
                  prep = (await activeResources.services.prepare(assemblyReq)) as Record<
                    string,
                    unknown
                  >;
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
                      message: redactSecretMentions(
                        err instanceof Error ? err.message : String(err)
                      )
                    }
                  };
                }
                const assemblyOutcomeStr =
                  typeof prep.outcome === "string" ? prep.outcome : String(prep.code ?? "error");
                if (prep.outcome === "persisted" || prep.outcome === "identical_replay") {
                  const bundleId = prep.rowId as number;
                  const assemblyWarnings = Array.isArray(prep.warnings)
                    ? (prep.warnings as string[]).map(redactSecretMentions)
                    : [];
                  const briefArtifact = prep.embeddedBrief ?? null;
                  const briefOutcomeStr = briefArtifact ? "reused" : null;
                  if (activeResources.services.persistBrief && briefArtifact) {
                    try {
                      await activeResources.services.persistBrief({
                        bundleId,
                        bundleHash: prep.payloadHash as string,
                        brief: briefArtifact as PersistedResearchBrief,
                        pair: "SOL/USDC",
                        evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                        codeVersion: config.codeVersion,
                        runId: pipelineRunId,
                        expiresAtUnixMs: activeEvaluationTimeUnixMs + 3600000
                      });
                    } catch (err) {
                      return {
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
                      assemblyOutcome: assemblyOutcomeStr,
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
                    };
                  }

                  const isPositionDegraded =
                    collectionStatus === "PARTIAL" || publication.outcome === "created_degraded";
                  const positionStatus: PositionPipelineStatus = isPositionDegraded
                    ? "degraded"
                    : "complete";

                  return {
                    positionId,
                    correlationId,
                    bundleId,
                    assemblyOutcome: assemblyOutcomeStr,
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
                  };
                }

                const preparedPayload = prep.prepared;
                let brief: Record<string, unknown> | null = null;
                try {
                  brief = (await activeResources.services.generateBrief({
                    evidenceBundlePayload: preparedPayload as EvidenceBundleV1,
                    pair: "SOL/USDC",
                    evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                    codeVersion: config.codeVersion,
                    runId: pipelineRunId
                  })) as Record<string, unknown>;
                } catch (err) {
                  return {
                    positionId,
                    correlationId,
                    bundleId: null,
                    assemblyOutcome: assemblyOutcomeStr,
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

                const briefOutcomeStr = brief.outcome as string;
                if (brief.outcome === "no_brief") {
                  return {
                    positionId,
                    correlationId,
                    bundleId: null,
                    assemblyOutcome: assemblyOutcomeStr,
                    briefOutcome: briefOutcomeStr,
                    publishOutcome: null,
                    status: "failed",
                    warnings: [],
                    diagnostic: {
                      stage: "brief",
                      code: "NO_BRIEF",
                      message: redactSecretMentions(
                        `Brief generation returned no_brief (${brief.reason as string})`
                      )
                    }
                  };
                }

                const briefArtifact = brief.brief;
                let fin: Record<string, unknown> | null = null;
                try {
                  fin = (await activeResources.services.finalize(
                    preparedPayload,
                    briefArtifact as PersistedResearchBrief
                  )) as Record<string, unknown>;
                } catch (err) {
                  return {
                    positionId,
                    correlationId,
                    bundleId: null,
                    assemblyOutcome: assemblyOutcomeStr,
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

                const finOutcomeStr =
                  typeof fin.outcome === "string" ? fin.outcome : String(fin.code ?? "error");
                const isFinSuccess =
                  fin.outcome === "persisted" || fin.outcome === "identical_replay";
                if (!isFinSuccess || !("rowId" in fin)) {
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
                        `Finalize failed with outcome: ${finOutcomeStr}`
                      )
                    }
                  };
                }

                const bundleId = fin.rowId as number;
                const assemblyWarnings = Array.isArray(fin.warnings)
                  ? (fin.warnings as string[]).map(redactSecretMentions)
                  : [];

                if (activeResources.services.persistBrief && briefArtifact) {
                  try {
                    await activeResources.services.persistBrief({
                      bundleId,
                      bundleHash: fin.payloadHash as string,
                      brief: briefArtifact as PersistedResearchBrief,
                      pair: "SOL/USDC",
                      evaluationTimeUnixMs: activeEvaluationTimeUnixMs,
                      codeVersion: config.codeVersion,
                      runId: pipelineRunId,
                      expiresAtUnixMs: activeEvaluationTimeUnixMs + 3600000
                    });
                  } catch (err) {
                    return {
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
                    assemblyOutcome: assemblyOutcomeStr,
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
                  assemblyOutcome: assemblyOutcomeStr,
                  briefOutcome: briefOutcomeStr,
                  publishOutcome: publishOutcomeStr,
                  status: positionStatus,
                  warnings: Object.freeze(assemblyWarnings),
                  diagnostic: null
                };
              }

              try {
                if (!activeResources.services.assemble) {
                  throw new Error(
                    "CoreEvidencePipelineServices: missing assemble or prepare service"
                  );
                }
                assembly = await activeResources.services.assemble(assemblyReq);
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

              const assemblyOutcomeStr = "outcome" in assembly ? assembly.outcome : assembly.code;
              const isAssemblySuccess =
                "outcome" in assembly &&
                (assembly.outcome === "persisted" || assembly.outcome === "identical_replay");

              if (!isAssemblySuccess || !("rowId" in assembly)) {
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
                      `Assembly failed with outcome: ${assemblyOutcomeStr}`
                    )
                  }
                };
              }

              const bundleId = assembly.rowId;
              const assemblyWarnings =
                "warnings" in assembly && Array.isArray(assembly.warnings)
                  ? assembly.warnings.map(redactSecretMentions)
                  : [];

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let brief: any;
              try {
                brief = await activeResources.services.generateBrief({
                  evidenceBundleId: bundleId,
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
                };
              }

              const briefOutcomeStr = brief.outcome;
              if (brief.outcome === "no_brief") {
                return {
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
                };
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
                assemblyOutcome: assemblyOutcomeStr,
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
