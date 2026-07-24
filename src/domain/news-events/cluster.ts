import type { NewsEvidencePayload } from "../../contracts/news-events.js";
import type { UnclusteredNewsEvidencePayload } from "./normalize.js";
import { canonicalHash } from "../content-hash.js";

export interface ClusterNewsEvidenceInput {
  readonly historical: readonly NewsEvidencePayload[];
  readonly incoming: readonly UnclusteredNewsEvidencePayload[];
}

const JACCARD_THRESHOLD = 0.8;
const TIME_WINDOW_MS = 72 * 60 * 60 * 1000;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "been",
  "be",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their"
]);

function normalizeText(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));

  return [...new Set(cleaned)].sort();
}

function extractNumbers(text: string): string[] {
  const matches = text.match(/\$?\d+\.?\d*/g);
  return matches ? Array.from(matches) : [];
}

function normalizeForStructureComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.$]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\$?\d+\.?\d*/g, "#");
}

function claimsHaveSameStructureButDifferentNumbers(textA: string, textB: string): boolean {
  const numsA = extractNumbers(textA);
  const numsB = extractNumbers(textB);
  if (numsA.length === 0 || numsB.length === 0) return false;
  if (numsA.length !== numsB.length) return false;
  const normalizedA = normalizeForStructureComparison(textA);
  const normalizedB = normalizeForStructureComparison(textB);
  if (normalizedA !== normalizedB) return false;
  for (let i = 0; i < numsA.length; i++) {
    if (numsA[i] !== numsB[i]) return true;
  }
  return false;
}

function hasClaimConflict(claimsA: readonly string[], claimsB: readonly string[]): boolean {
  if (claimsA.length === 0 || claimsB.length === 0) return false;
  for (const claimA of claimsA) {
    for (const claimB of claimsB) {
      if (claimsHaveSameStructureButDifferentNumbers(claimA, claimB)) {
        return true;
      }
    }
  }
  return false;
}

function computeJaccardIndex(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function hasScopeOverlap(payloadA: NewsEvidencePayload, payloadB: NewsEvidencePayload): boolean {
  const scopeA = new Set(
    [...payloadA.affectedAssets, ...payloadA.affectedProtocols].map((s) => s.toLowerCase())
  );
  const scopeB = new Set(
    [...payloadB.affectedAssets, ...payloadB.affectedProtocols].map((s) => s.toLowerCase())
  );
  for (const value of scopeA) {
    if (scopeB.has(value)) return true;
  }
  return false;
}

function isWithinTimeWindow(payloadA: NewsEvidencePayload, payloadB: NewsEvidencePayload): boolean {
  const diff = Math.abs(payloadA.asOfUnixMs - payloadB.asOfUnixMs);
  return diff < TIME_WINDOW_MS;
}

function computeTitleTopicTokens(payload: NewsEvidencePayload): string[] {
  const titleTokens = normalizeText(payload.title);
  const topicTokens = payload.topicTags.map((t) => t.toLowerCase());
  return [...new Set([...titleTokens, ...topicTokens])];
}

function isNearDuplicate(payloadA: NewsEvidencePayload, payloadB: NewsEvidencePayload): boolean {
  if (payloadA.evidenceKind !== payloadB.evidenceKind) return false;
  if (!isWithinTimeWindow(payloadA, payloadB)) return false;
  if (!hasScopeOverlap(payloadA, payloadB)) return false;

  const tokensA = computeTitleTopicTokens(payloadA);
  const tokensB = computeTitleTopicTokens(payloadB);
  return computeJaccardIndex(tokensA, tokensB) >= JACCARD_THRESHOLD;
}

function representativeTimestamp(payload: NewsEvidencePayload): number {
  return payload.publishedAtUnixMs ?? payload.asOfUnixMs;
}

function deriveRepresentativeTuple(payload: NewsEvidencePayload): string {
  return [
    representativeTimestamp(payload).toString(),
    payload.publisher.publisherId,
    payload.articleId,
    payload.sourceVersionId
  ].join("::");
}

async function deriveClusterId(representative: NewsEvidencePayload): Promise<string> {
  const tuple = deriveRepresentativeTuple(representative);
  return canonicalHash(tuple);
}

function sortByRepresentative(payloads: NewsEvidencePayload[]): NewsEvidencePayload[] {
  return [...payloads].sort((a, b) => {
    const tsA = representativeTimestamp(a);
    const tsB = representativeTimestamp(b);
    if (tsA !== tsB) return tsA - tsB;

    const publisherCompare = a.publisher.publisherId.localeCompare(b.publisher.publisherId);
    if (publisherCompare !== 0) return publisherCompare;

    const articleCompare = a.articleId.localeCompare(b.articleId);
    if (articleCompare !== 0) return articleCompare;

    return a.sourceVersionId.localeCompare(b.sourceVersionId);
  });
}

interface RecordInfo {
  record: NewsEvidencePayload;
  syndicationMatches: string[];
  correctionOf: string | null;
  correctionChain: string[];
}

function getRecordKey(record: NewsEvidencePayload): string {
  return `${record.articleId}::${record.publisher.publisherId}::${record.sourceVersionId}`;
}

function buildRecordInfoMap(allRecords: NewsEvidencePayload[]): Map<string, RecordInfo> {
  const infoMap = new Map<string, RecordInfo>();

  for (const record of allRecords) {
    infoMap.set(getRecordKey(record), {
      record,
      syndicationMatches: [],
      correctionOf: null,
      correctionChain: []
    });
  }

  for (const record of allRecords) {
    const info = infoMap.get(getRecordKey(record))!;

    if (record.syndicationId !== null) {
      for (const other of allRecords) {
        if (other === record) continue;
        if (other.syndicationId !== null && other.syndicationId === record.syndicationId) {
          info.syndicationMatches.push(getRecordKey(other));
        }
      }
    }
  }

  for (const record of allRecords) {
    if (record.correctsSourceVersionId === null) continue;

    const targetKey = `${record.articleId}::${record.publisher.publisherId}::${record.correctsSourceVersionId}`;
    if (infoMap.has(targetKey)) {
      const info = infoMap.get(getRecordKey(record))!;
      info.correctionOf = targetKey;
    }
  }

  return infoMap;
}

function buildSyndicationClusters(
  allRecords: NewsEvidencePayload[],
  infoMap: Map<string, RecordInfo>
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const record of allRecords) {
    const key = getRecordKey(record);
    if (assigned.has(key)) continue;

    const info = infoMap.get(key)!;
    if (info.syndicationMatches.length === 0) continue;

    const clusterKeys = [key, ...info.syndicationMatches];
    clusterKeys.forEach((k) => assigned.add(k));
    clusters.set(key, clusterKeys);
  }

  return clusters;
}

function buildCorrectionClusters(
  allRecords: NewsEvidencePayload[],
  infoMap: Map<string, RecordInfo>
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const record of allRecords) {
    const key = getRecordKey(record);
    if (assigned.has(key)) continue;

    const info = infoMap.get(key)!;
    if (info.correctionOf === null) continue;

    const chain: string[] = [key];
    assigned.add(key);

    let currentKey: string | undefined = key;
    while (currentKey !== undefined) {
      const currentInfo = infoMap.get(currentKey);
      if (!currentInfo || currentInfo.correctionOf === null) break;
      const targetKey = currentInfo.correctionOf;
      if (assigned.has(targetKey)) {
        chain.push(targetKey);
        break;
      }
      chain.push(targetKey);
      assigned.add(targetKey);
      currentKey = targetKey;
    }

    if (chain.length > 0) {
      clusters.set(key, chain);
    }
  }

  return clusters;
}

function buildJaccardClusters(
  allRecords: NewsEvidencePayload[],
  infoMap: Map<string, RecordInfo>
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const record of allRecords) {
    const key = getRecordKey(record);
    if (assigned.has(key)) continue;

    const info = infoMap.get(key)!;
    if (info.correctionOf !== null) continue;

    const clusterKeys = [key];
    assigned.add(key);

    for (const other of allRecords) {
      const otherKey = getRecordKey(other);
      if (otherKey === key) continue;
      if (assigned.has(otherKey)) continue;

      const otherInfo = infoMap.get(otherKey)!;
      if (otherInfo.correctionOf !== null) continue;

      if (isNearDuplicate(record, other)) {
        clusterKeys.push(otherKey);
        assigned.add(otherKey);
      }
    }

    if (clusterKeys.length > 1) {
      clusters.set(key, clusterKeys);
    }
  }

  return clusters;
}

function mergeAllClusters(
  syndicationClusters: Map<string, string[]>,
  correctionClusters: Map<string, string[]>,
  jaccardClusters: Map<string, string[]>
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  const keyToClusterId = new Map<string, string>();

  for (const [clusterId, keys] of syndicationClusters) {
    merged.set(clusterId, keys);
    for (const k of keys) {
      keyToClusterId.set(k, clusterId);
    }
  }

  for (const [clusterId, keys] of correctionClusters) {
    const existingKeys = new Set<string>();
    const clustersToDelete = new Set<string>();
    for (const k of keys) {
      const existingClusterId = keyToClusterId.get(k);
      if (existingClusterId !== undefined) {
        const existing = merged.get(existingClusterId) ?? [];
        existing.forEach((ek) => existingKeys.add(ek));
        if (existingClusterId !== clusterId) {
          clustersToDelete.add(existingClusterId);
        }
      }
    }

    const allKeys = [...existingKeys, ...keys];
    const uniqKeys = [...new Set(allKeys)];
    merged.set(clusterId, uniqKeys);
    for (const k of uniqKeys) {
      keyToClusterId.set(k, clusterId);
    }
    for (const oldClusterId of clustersToDelete) {
      merged.delete(oldClusterId);
    }
  }

  for (const [clusterId, keys] of jaccardClusters) {
    const existingKeys = new Set<string>();
    const clustersToDelete = new Set<string>();
    for (const k of keys) {
      const existingClusterId = keyToClusterId.get(k);
      if (existingClusterId !== undefined) {
        const existing = merged.get(existingClusterId) ?? [];
        existing.forEach((ek) => existingKeys.add(ek));
        if (existingClusterId !== clusterId) {
          clustersToDelete.add(existingClusterId);
        }
      }
    }

    const allKeys = [...existingKeys, ...keys];
    const uniqKeys = [...new Set(allKeys)];
    merged.set(clusterId, uniqKeys);
    for (const k of uniqKeys) {
      keyToClusterId.set(k, clusterId);
    }
    for (const oldClusterId of clustersToDelete) {
      merged.delete(oldClusterId);
    }
  }

  return merged;
}

function isSyndicationCluster(infoMap: Map<string, RecordInfo>, keys: string[]): boolean {
  let syndicationId: string | null = null;
  for (const k of keys) {
    const info = infoMap.get(k);
    const recordSyndicationId = info?.record.syndicationId ?? null;
    if (recordSyndicationId === null) return false;
    if (syndicationId === null) {
      syndicationId = recordSyndicationId;
    } else if (syndicationId !== recordSyndicationId) {
      return false;
    }
  }
  return syndicationId !== null;
}

async function resolveClusters(
  clusters: Map<string, string[]>,
  allRecords: NewsEvidencePayload[],
  infoMap: Map<string, RecordInfo>
): Promise<NewsEvidencePayload[]> {
  const recordByKey = new Map<string, NewsEvidencePayload>();
  for (const record of allRecords) {
    recordByKey.set(getRecordKey(record), record);
  }

  const resolved: NewsEvidencePayload[] = [];
  const processedKeys = new Set<string>();

  for (const [, keys] of clusters) {
    if (keys.length === 0) continue;

    const members = keys
      .map((k) => recordByKey.get(k))
      .filter((r): r is NewsEvidencePayload => r !== undefined);

    if (members.length === 0) continue;

    const sorted = sortByRepresentative(members);
    const representative = sorted[0];
    if (!representative) continue;
    const clusterIdHash = await deriveClusterId(representative);

    const uniqueClaims = [...new Set(members.flatMap((p) => p.extractedClaims))].sort();

    const uniquePairs = new Set(
      members.map((p) => `${p.publisher.publisherId}::${p.originatingReportId}`)
    );

    const corrections = members.filter((m) => m.correctsSourceVersionId !== null);
    let hasConflict = false;
    if (corrections.length > 1) {
      const correctionsByTarget = new Map<string, NewsEvidencePayload[]>();
      for (const c of corrections) {
        const targetId = c.correctsSourceVersionId as string;
        const arr = correctionsByTarget.get(targetId) ?? [];
        arr.push(c);
        correctionsByTarget.set(targetId, arr);
      }
      if (correctionsByTarget.size === 1) {
        const firstEntry = correctionsByTarget.entries().next().value;
        if (firstEntry && firstEntry[1].length > 1) {
          hasConflict = true;
        }
      }
    }

    if (!hasConflict && members.length > 1) {
      for (let i = 0; i < members.length && !hasConflict; i++) {
        for (let j = i + 1; j < members.length && !hasConflict; j++) {
          const memberI = members[i];
          const memberJ = members[j];
          if (
            memberI &&
            memberJ &&
            hasClaimConflict(memberI.extractedClaims, memberJ.extractedClaims)
          ) {
            hasConflict = true;
          }
        }
      }
    }

    let corroborationState: "single_source" | "independently_corroborated" | "conflicting";
    let warnings: NewsEvidencePayload["warnings"] = [];

    if (hasConflict) {
      corroborationState = "conflicting";
      warnings = ["source_disagreement"];
    } else if (uniquePairs.size >= 2 && !isSyndicationCluster(infoMap, keys)) {
      corroborationState = "independently_corroborated";
    } else {
      corroborationState = "single_source";
    }

    for (const member of sorted) {
      const memberWarnings = member.warnings.filter((w) => w !== "source_disagreement");
      resolved.push({
        ...member,
        clusterId: clusterIdHash,
        corroborationState,
        sourceReferences: [...new Set(member.sourceReferences)].sort(),
        extractedClaims: uniqueClaims,
        warnings: [...memberWarnings, ...warnings]
      });
      processedKeys.add(getRecordKey(member));
    }
  }

  for (const record of allRecords) {
    const key = getRecordKey(record);
    if (!processedKeys.has(key)) {
      const singleResolved = await resolveSingleRecord(record);
      resolved.push(singleResolved);
    }
  }

  return resolved;
}

async function resolveSingleRecord(record: NewsEvidencePayload): Promise<NewsEvidencePayload> {
  const clusterIdHash = await deriveClusterId(record);

  return {
    ...record,
    clusterId: clusterIdHash,
    corroborationState: "single_source",
    sourceReferences: [...new Set(record.sourceReferences)].sort(),
    extractedClaims: [...record.extractedClaims],
    warnings: record.warnings
  };
}

export async function clusterNewsEvidence(
  input: ClusterNewsEvidenceInput
): Promise<readonly NewsEvidencePayload[]> {
  const historical = [...input.historical];
  const incoming = [...input.incoming].map((p) => ({ ...p }) as NewsEvidencePayload);

  const allRecords: NewsEvidencePayload[] = [...historical, ...incoming];

  if (allRecords.length === 0) return [];

  const sortedAllRecords = sortByRepresentative(allRecords);

  const infoMap = buildRecordInfoMap(sortedAllRecords);

  const syndicationClusters = buildSyndicationClusters(sortedAllRecords, infoMap);
  const correctionClusters = buildCorrectionClusters(sortedAllRecords, infoMap);
  const jaccardClusters = buildJaccardClusters(sortedAllRecords, infoMap);

  const mergedClusters = mergeAllClusters(syndicationClusters, correctionClusters, jaccardClusters);

  const resolved = await resolveClusters(mergedClusters, sortedAllRecords, infoMap);

  return resolved;
}
