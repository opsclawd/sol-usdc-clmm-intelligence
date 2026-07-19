import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";

export interface CollectionRunContext {
  readonly runId: string;
  readonly startedAtUnixMs: number;
}

export interface CreateCollectionRunContextDeps {
  env: EnvReader;
  clock: Clock;
  runIdFactory: RunIdFactory;
}

export function createCollectionRunContext(
  deps: CreateCollectionRunContextDeps
): CollectionRunContext {
  const operatorRunId = deps.env.getOptional("INTELLIGENCE_PIPELINE_RUN_ID")?.trim();
  const runId =
    operatorRunId && operatorRunId.length > 0 ? operatorRunId : deps.runIdFactory.nextRunId();

  if (!runId || runId.trim().length === 0) {
    throw new Error("INTELLIGENCE_PIPELINE_RUN_ID or generated run ID is empty");
  }

  const nowIso = deps.clock.now();
  const startedAtUnixMs = Date.parse(nowIso);
  if (isNaN(startedAtUnixMs) || !isFinite(startedAtUnixMs)) {
    throw new Error(`Clock returned invalid time: ${nowIso}`);
  }

  return Object.freeze({
    runId,
    startedAtUnixMs
  });
}
