import type { SupportResistanceSourcePort } from "../ports/support-resistance-source.js";
import type { RawObservationRepo } from "../ports/observation-repo.js";
import type { NormalizedObservationRepo } from "../ports/normalized-observation-repo.js";
import { createCollectionRunContext } from "../application/create-collection-run-context.js";
import {
  collectSupportResistance,
  type CollectSupportResistanceDeps
} from "../application/collect-support-resistance.js";
import type { SupportResistanceCollectionResult } from "../contracts/support-resistance.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";
import type { RunIdFactory } from "../ports/run-id.js";

export interface SupportResistanceJobDeps {
  supportResistanceSource: SupportResistanceSourcePort;
  rawObservationRepo: RawObservationRepo;
  normalizedObservationRepo: NormalizedObservationRepo;
  env: EnvReader;
  clock: Clock;
  runIdFactory: RunIdFactory;
}

export function supportResistanceJob(
  deps: SupportResistanceJobDeps
): () => Promise<SupportResistanceCollectionResult> {
  return () => runSupportResistanceJob(deps);
}

export async function runSupportResistanceJob(
  deps: SupportResistanceJobDeps
): Promise<SupportResistanceCollectionResult> {
  const context = createCollectionRunContext({
    env: deps.env,
    clock: deps.clock,
    runIdFactory: deps.runIdFactory
  });

  const collectDeps: CollectSupportResistanceDeps = {
    supportResistanceSource: deps.supportResistanceSource,
    rawObservationRepo: deps.rawObservationRepo,
    normalizedObservationRepo: deps.normalizedObservationRepo
  };

  return collectSupportResistance(collectDeps, context);
}
