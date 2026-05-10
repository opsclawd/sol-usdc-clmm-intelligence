import type { DataQuality } from "./types.js";

export interface DataQualityAssessment {
  quality: DataQuality;
  missing: string[];
}

export function assessDataQuality(inputs: Record<string, unknown>): DataQualityAssessment {
  const missing = Object.entries(inputs)
    .filter(([, value]) => value == null)
    .map(([key]) => key);

  if (missing.length === 0) return { quality: "complete", missing };
  if (missing.length <= 2) return { quality: "partial", missing };
  return { quality: "stale", missing };
}
