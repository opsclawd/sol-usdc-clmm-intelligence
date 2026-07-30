import type { NormalizedObservationRow } from "../../contracts/normalized-observation.js";
import type { NewsEvidencePayload } from "../../contracts/news-events.js";

export interface NewsEvidenceSelectionRequest {
  readonly evaluationTimeUnixMs: number;
  readonly candidates: readonly NormalizedObservationRow[];
  readonly maxItems: number;
}

export interface SelectedNewsEvidence {
  readonly row: NormalizedObservationRow;
  readonly payload: NewsEvidencePayload;
}

function isValidNewsPayload(
  payload: unknown,
  observationKind: string
): payload is NewsEvidencePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;

  if (p.evidenceKind !== observationKind) return false;
  if (typeof p.articleId !== "string" || typeof p.sourceVersionId !== "string") return false;
  if (typeof p.clusterId !== "string") return false;
  if (typeof p.title !== "string" || typeof p.factualSummary !== "string") return false;
  if (p.correctsSourceVersionId !== null && typeof p.correctsSourceVersionId !== "string")
    return false;

  if (typeof p.publisher !== "object" || p.publisher === null) return false;
  const pub = p.publisher as Record<string, unknown>;
  if (typeof pub.publisherId !== "string") return false;

  if (!Array.isArray(p.affectedAssets) || !Array.isArray(p.affectedProtocols)) return false;
  if (!Array.isArray(p.extractedClaims) || !Array.isArray(p.sourceReferences)) return false;
  if (!Array.isArray(p.warnings)) return false;

  if (typeof p.asOfUnixMs !== "number" || typeof p.expiresAtUnixMs !== "number") return false;
  if (typeof p.retrievedAtUnixMs !== "number") return false;

  const allowedCorroboration = [
    "unconfirmed",
    "single_source",
    "independently_corroborated",
    "conflicting"
  ];
  if (
    typeof p.corroborationState !== "string" ||
    !allowedCorroboration.includes(p.corroborationState)
  ) {
    return false;
  }

  return true;
}

function isValidCandidateRow(row: NormalizedObservationRow): boolean {
  if (!row || typeof row !== "object") return false;
  if (typeof row.id !== "number") return false;

  const validPair =
    (row.source === "crypto-news-api" && row.observationKind === "ecosystem_news") ||
    (row.source === "regulatory-monitor-api" && row.observationKind === "regulatory_risk");

  if (!validPair) return false;

  return isValidNewsPayload(row.payload, row.observationKind);
}

function isRelevantPayload(payload: NewsEvidencePayload): boolean {
  for (const asset of payload.affectedAssets) {
    const upper = asset.toUpperCase();
    if (upper === "SOL" || upper === "USDC") return true;
  }
  for (const protocol of payload.affectedProtocols) {
    const lower = protocol.toLowerCase();
    if (lower === "solana" || lower === "orca") return true;
  }
  return false;
}

function getCorroborationRank(state: string): number {
  switch (state) {
    case "independently_corroborated":
      return 1;
    case "single_source":
      return 2;
    case "unconfirmed":
      return 3;
    case "conflicting":
      return 4;
    default:
      return 5;
  }
}

interface EvaluatedNewsItem {
  readonly row: NormalizedObservationRow;
  readonly payload: NewsEvidencePayload;
  readonly isRelevant: boolean;
  readonly corroborationRank: number;
  readonly confidenceScore: number;
  readonly eventTime: number;
}

function compareNewsItems(a: EvaluatedNewsItem, b: EvaluatedNewsItem): number {
  if (a.isRelevant !== b.isRelevant) {
    return a.isRelevant ? -1 : 1;
  }
  if (a.corroborationRank !== b.corroborationRank) {
    return a.corroborationRank - b.corroborationRank;
  }
  if (a.confidenceScore !== b.confidenceScore) {
    return b.confidenceScore - a.confidenceScore;
  }
  if (a.eventTime !== b.eventTime) {
    return b.eventTime - a.eventTime;
  }
  const sourceComp = a.row.source.localeCompare(b.row.source);
  if (sourceComp !== 0) return sourceComp;

  const articleComp = a.payload.articleId.localeCompare(b.payload.articleId);
  if (articleComp !== 0) return articleComp;

  const versionComp = a.payload.sourceVersionId.localeCompare(b.payload.sourceVersionId);
  if (versionComp !== 0) return versionComp;

  const hashComp = a.row.payloadHash.localeCompare(b.row.payloadHash);
  if (hashComp !== 0) return hashComp;

  return a.row.id - b.row.id;
}

export function selectNewsEvidence(
  request: NewsEvidenceSelectionRequest
): readonly SelectedNewsEvidence[] {
  const { evaluationTimeUnixMs, candidates, maxItems } = request;

  // Step 1: Filter valid rows
  const validCandidates: Array<{ row: NormalizedObservationRow; payload: NewsEvidencePayload }> =
    [];
  for (const row of candidates) {
    if (isValidCandidateRow(row)) {
      validCandidates.push({ row, payload: row.payload as NewsEvidencePayload });
    }
  }

  // Step 2: Group by article identity
  const articleGroups = new Map<
    string,
    Array<{ row: NormalizedObservationRow; payload: NewsEvidencePayload }>
  >();
  for (const candidate of validCandidates) {
    const key = `${candidate.row.source}::${candidate.payload.publisher.publisherId}::${candidate.payload.articleId}`;
    const group = articleGroups.get(key) ?? [];
    group.push(candidate);
    articleGroups.set(key, group);
  }

  // Step 3: Resolve terminal correction per article identity
  const selectedTerminalCandidates: Array<{
    row: NormalizedObservationRow;
    payload: NewsEvidencePayload;
  }> = [];

  for (const [, group] of articleGroups) {
    // Check duplicate version IDs with different payload hashes
    const versionsMap = new Map<string, string>();
    let hasDuplicateVersionHashMismatch = false;

    for (const item of group) {
      const vId = item.payload.sourceVersionId;
      const existingHash = versionsMap.get(vId);
      if (existingHash !== undefined && existingHash !== item.row.payloadHash) {
        hasDuplicateVersionHashMismatch = true;
        break;
      }
      versionsMap.set(vId, item.row.payloadHash);
    }

    if (hasDuplicateVersionHashMismatch) continue;

    // Check for cycles in correction chain
    let hasCycle = false;
    const versionItemMap = new Map<
      string,
      { row: NormalizedObservationRow; payload: NewsEvidencePayload }
    >();
    for (const item of group) {
      versionItemMap.set(item.payload.sourceVersionId, item);
    }

    for (const item of group) {
      const visited = new Set<string>();
      visited.add(item.payload.sourceVersionId);
      let curr = item.payload.correctsSourceVersionId;

      while (curr !== null) {
        if (visited.has(curr)) {
          hasCycle = true;
          break;
        }
        visited.add(curr);
        const predecessorItem = versionItemMap.get(curr);
        curr = predecessorItem ? predecessorItem.payload.correctsSourceVersionId : null;
      }

      if (hasCycle) break;
    }

    if (hasCycle) continue;

    // Identify predecessor version IDs (corrected by another version in candidate group)
    const predecessorVersionIds = new Set<string>();
    for (const item of group) {
      if (item.payload.correctsSourceVersionId !== null) {
        predecessorVersionIds.add(item.payload.correctsSourceVersionId);
      }
    }

    // Terminal versions: versions in group that are NOT predecessors
    const terminalVersions = group.filter(
      (item) => !predecessorVersionIds.has(item.payload.sourceVersionId)
    );
    if (terminalVersions.length === 0) continue;

    // Sort terminal versions to pick the top 1 terminal candidate
    terminalVersions.sort((a, b) => {
      const tsA = a.payload.sourceUpdatedAtUnixMs ?? a.payload.asOfUnixMs;
      const tsB = b.payload.sourceUpdatedAtUnixMs ?? b.payload.asOfUnixMs;
      if (tsA !== tsB) return tsB - tsA;

      if (a.row.receivedAtUnixMs !== b.row.receivedAtUnixMs) {
        return b.row.receivedAtUnixMs - a.row.receivedAtUnixMs;
      }

      const vComp = b.payload.sourceVersionId.localeCompare(a.payload.sourceVersionId);
      if (vComp !== 0) return vComp;

      const hComp = b.row.payloadHash.localeCompare(a.row.payloadHash);
      if (hComp !== 0) return hComp;

      return b.row.id - a.row.id;
    });

    const terminalCandidate = terminalVersions[0];

    // Apply Freshness / Expiry / Future Checks on terminalCandidate
    const row = terminalCandidate.row;
    const payload = terminalCandidate.payload;

    if (row.isStale) continue;
    if (row.validUntilUnixMs !== null && row.validUntilUnixMs <= evaluationTimeUnixMs) continue;
    if (payload.expiresAtUnixMs <= evaluationTimeUnixMs) continue;
    if (payload.asOfUnixMs > evaluationTimeUnixMs) continue;
    if (payload.publishedAtUnixMs !== null && payload.publishedAtUnixMs > evaluationTimeUnixMs)
      continue;
    if (row.receivedAtUnixMs > evaluationTimeUnixMs) continue;

    selectedTerminalCandidates.push(terminalCandidate);
  }

  // Step 4: Evaluate relevance and ranking fields for surviving items
  const evaluatedItems: EvaluatedNewsItem[] = selectedTerminalCandidates.map(({ row, payload }) => {
    const isRelevant = isRelevantPayload(payload);
    const cRank = getCorroborationRank(payload.corroborationState);
    const confidenceScore = row.confidenceComposite ?? row.confidence.compositeScore;
    const eventTime =
      payload.publishedAtUnixMs ?? payload.sourceUpdatedAtUnixMs ?? payload.asOfUnixMs;

    return {
      row,
      payload,
      isRelevant,
      corroborationRank: cRank,
      confidenceScore,
      eventTime
    };
  });

  // Step 5: Cluster Representation
  const clusterGroups = new Map<string, EvaluatedNewsItem[]>();
  for (const item of evaluatedItems) {
    const cKey =
      item.payload.clusterId !== "" ? item.payload.clusterId : `unclustered-${item.row.id}`;
    const grp = clusterGroups.get(cKey) ?? [];
    grp.push(item);
    clusterGroups.set(cKey, grp);
  }

  const retainedItems: EvaluatedNewsItem[] = [];

  for (const [, items] of clusterGroups) {
    items.sort(compareNewsItems);

    const nonConflicting = items.filter((i) => i.payload.corroborationState !== "conflicting");
    const conflicting = items.filter((i) => i.payload.corroborationState === "conflicting");

    if (conflicting.length === 0) {
      if (nonConflicting.length > 0) {
        retainedItems.push(nonConflicting[0]);
      }
    } else {
      if (nonConflicting.length > 0) {
        retainedItems.push(nonConflicting[0]);
        retainedItems.push(conflicting[0]);
      } else {
        retainedItems.push(...conflicting.slice(0, 2));
      }
    }
  }

  // Step 6: Final Sort & Operational Cap
  retainedItems.sort(compareNewsItems);

  const effectiveMaxItems = Math.min(Math.max(0, Math.floor(maxItems)), 16);
  const sliced = retainedItems.slice(0, effectiveMaxItems);

  return sliced.map((item) => ({
    row: item.row,
    payload: item.payload
  }));
}
