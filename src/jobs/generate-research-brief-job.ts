import type {
  GenerateResearchBriefDeps,
  GenerateResearchBriefParams,
  GenerateResearchBriefOutcome
} from "../application/generate-research-brief.js";
import { generateResearchBrief } from "../application/generate-research-brief.js";
import type { DbConnection } from "../ports/db.js";

export interface GenerateResearchBriefJobDeps extends GenerateResearchBriefDeps {
  readonly dbConnection?: DbConnection;
}

export type GenerateResearchBriefJobResult = GenerateResearchBriefOutcome;

export function generateResearchBriefJob(
  deps: GenerateResearchBriefJobDeps
): (params: GenerateResearchBriefParams) => Promise<GenerateResearchBriefJobResult> {
  return async (params: GenerateResearchBriefParams) => {
    try {
      const result = await generateResearchBrief(deps, params);
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
