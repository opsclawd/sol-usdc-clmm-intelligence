import type {
  GenerateResearchBriefDeps,
  GenerateAndPersistResearchBriefParams,
  GenerateAndPersistResearchBriefOutcome
} from "../application/generate-research-brief.js";
import { generateAndPersistResearchBrief } from "../application/generate-research-brief.js";
import type { DbConnection } from "../ports/db.js";

export interface GenerateResearchBriefJobDeps extends GenerateResearchBriefDeps {
  readonly dbConnection?: DbConnection;
}

export type GenerateResearchBriefJobResult = GenerateAndPersistResearchBriefOutcome;

export function generateResearchBriefJob(
  deps: GenerateResearchBriefJobDeps
): (params: GenerateAndPersistResearchBriefParams) => Promise<GenerateResearchBriefJobResult> {
  return async (params: GenerateAndPersistResearchBriefParams) => {
    try {
      const result = await generateAndPersistResearchBrief(deps, params);
      return result;
    } finally {
      if (deps.dbConnection) {
        try {
          await deps.dbConnection.close();
        } catch {
          // ignore error on close
        }
      }
    }
  };
}
