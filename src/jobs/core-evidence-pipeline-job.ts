import type {
  RunCoreEvidencePipelineDeps,
  CoreEvidencePipelineResult
} from "../application/run-core-evidence-pipeline.js";
import { runCoreEvidencePipeline } from "../application/run-core-evidence-pipeline.js";
import type { CoreEvidencePipelineConfig } from "../application/load-core-evidence-pipeline-config.js";

export type {
  CoreEvidencePipelineServices,
  CoreEvidencePipelineResources,
  RunCoreEvidencePipelineDeps,
  PipelineDiagnostic,
  PositionPipelineResult,
  CoreEvidencePipelineResult
} from "../application/run-core-evidence-pipeline.js";
export { runCoreEvidencePipeline } from "../application/run-core-evidence-pipeline.js";

export function coreEvidencePipelineJob(
  deps: RunCoreEvidencePipelineDeps
): (config: CoreEvidencePipelineConfig) => Promise<CoreEvidencePipelineResult> {
  return (config: CoreEvidencePipelineConfig) => runCoreEvidencePipeline(deps, config);
}
