import type { ResearchBriefRepo, ResearchBriefRow } from "../ports/brief-repo.js";
import type { PersistedResearchBrief } from "../contracts/research-brief.js";

// Mirrors the eligibility rules publish-evidence-bundle.ts uses when composing
// a bundle with a persisted brief: the brief must target this exact bundle
// identity (id + hash), be complete or degraded, and not have expired.
function isEligible(
  row: ResearchBriefRow,
  bundleId: number,
  bundleHash: string,
  nowUnixMs: number
): row is ResearchBriefRow & { structuredOutput: PersistedResearchBrief } {
  if (!row.structuredOutput) return false;
  const artifact = row.structuredOutput as PersistedResearchBrief;
  if (artifact.generationStatus !== "complete" && artifact.generationStatus !== "degraded") {
    return false;
  }
  if (
    artifact.sourceBundleRef?.bundleId !== bundleId ||
    artifact.sourceBundleRef?.bundleHash !== bundleHash
  ) {
    return false;
  }
  if (row.validUntilUnixMs !== null && row.validUntilUnixMs !== undefined) {
    if (row.validUntilUnixMs <= nowUnixMs) return false;
  }
  return true;
}

export async function findPersistedBriefForBundle(
  briefRepo: ResearchBriefRepo,
  bundleId: number,
  bundleHash: string,
  nowUnixMs: number
): Promise<PersistedResearchBrief | undefined> {
  let rows: ResearchBriefRow[];
  try {
    rows = await briefRepo.findByBundleId(bundleId);
  } catch {
    return undefined;
  }

  const eligible = rows
    .filter((row) => isEligible(row, bundleId, bundleHash, nowUnixMs))
    .sort((a, b) => {
      if (b.receivedAtUnixMs !== a.receivedAtUnixMs) {
        return b.receivedAtUnixMs - a.receivedAtUnixMs;
      }
      return b.id - a.id;
    });

  return eligible[0]?.structuredOutput as PersistedResearchBrief | undefined;
}
