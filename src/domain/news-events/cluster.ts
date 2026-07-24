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

function normalizeTextReplaceNumbers(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\d+\.?\d*\b/g, "#")
    .trim();
}

function hasClaimConflict(claimsA: readonly string[], claimsB: readonly string[]): boolean {
  if (claimsA.length === 0 || claimsB.length === 0) return false;
  const normalizedA = claimsA.map(normalizeTextReplaceNumbers).sort();
  const normalizedB = claimsB.map(normalizeTextReplaceNumbers).sort();
  if (normalizedA.join("|") !== normalizedB.join("|")) {
    return false;
  }
  const setA = new Set(claimsA);
  const setB = new Set(claimsB);
  if (setA.size !== setB.size) return true;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  return intersection < setA.size;
}

function computeJaccardIndex(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeScopeTokens(
  affectedAssets: readonly string[],
  affectedProtocols: readonly string[],
  affectedJurisdictions: readonly string[]
): string[] {
  return [...affectedAssets, ...affectedProtocols, ...affectedJurisdictions]
    .map((s) => s.toLowerCase())
    .sort();
}

function hasOverlappingScope(
  payloadA: NewsEvidencePayload,
  payloadB: NewsEvidencePayload
): boolean {
  const scopeA = computeScopeTokens(
    payloadA.affectedAssets,
    payloadA.affectedProtocols,
    payloadA.affectedJurisdictions
  );
  const scopeB = computeScopeTokens(
    payloadB.affectedAssets,
    payloadB.affectedProtocols,
    payloadB.affectedJurisdictions
  );
  if (scopeA.length === 0 && scopeB.length === 0) return true;
  if (scopeA.length === 0 || scopeB.length === 0) return false;
  return scopeA.some((token) => scopeB.includes(token));
}

function isWithinTimeWindow(payloadA: NewsEvidencePayload, payloadB: NewsEvidencePayload): boolean {
  const diff = Math.abs(payloadA.asOfUnixMs - payloadB.asOfUnixMs);
  return diff < TIME_WINDOW_MS;
}

function computeTitleTopicJaccard(
  payloadA: NewsEvidencePayload,
  payloadB: NewsEvidencePayload
): number {
  const titleTokensA = normalizeText(payloadA.title);
  const titleTokensB = normalizeText(payloadB.title);
  const topicTokensA = [...payloadA.topicTags];
  const topicTokensB = [...payloadB.topicTags];
  const combinedTokensA = [...titleTokensA, ...topicTokensA].sort();
  const combinedTokensB = [...titleTokensB, ...topicTokensB].sort();
  return computeJaccardIndex(combinedTokensA, combinedTokensB);
}

function computeContentSimilarity(
  payloadA: NewsEvidencePayload,
  payloadB: NewsEvidencePayload
): number {
  if (!hasOverlappingScope(payloadA, payloadB)) return 0;
  if (!isWithinTimeWindow(payloadA, payloadB)) return 0;
  return computeTitleTopicJaccard(payloadA, payloadB);
}

function deriveRepresentativeTuple(payload: NewsEvidencePayload): string {
  return [
    payload.publishedAtUnixMs?.toString() ?? "null",
    payload.publisher.publisherId,
    payload.articleId,
    payload.sourceVersionId
  ].join("|");
}

async function deriveClusterId(representative: NewsEvidencePayload): Promise<string> {
  const tuple = deriveRepresentativeTuple(representative);
  return canonicalHash(tuple);
}

function sortByRepresentative(payloads: NewsEvidencePayload[]): NewsEvidencePayload[] {
  return [...payloads].sort((a, b) => {
    const tupleA = deriveRepresentativeTuple(a);
    const tupleB = deriveRepresentativeTuple(b);
    return tupleA.localeCompare(tupleB);
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
      if (assigned.has(targetKey)) break;
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
  const recordByKey = new Map<string, NewsEvidencePayload>();
  for (const record of allRecords) {
    recordByKey.set(getRecordKey(record), record);
  }

  for (const record of allRecords) {
    const key = getRecordKey(record);
    if (assigned.has(key)) continue;

    const info = infoMap.get(key)!;
    if (info.correctionOf !== null) continue;
    if (info.syndicationMatches.length > 0) continue;

    const clusterKeys = [key];
    assigned.add(key);

    for (const other of allRecords) {
      const otherKey = getRecordKey(other);
      if (assigned.has(otherKey)) continue;

      const otherInfo = infoMap.get(otherKey)!;
      if (record.publisher.publisherId === other.publisher.publisherId) {
        continue;
      }
      if (otherInfo.correctionOf !== null) continue;
      if (otherInfo.syndicationMatches.length > 0) continue;

      const similarity = computeContentSimilarity(record, other);
      if (similarity >= JACCARD_THRESHOLD) {
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
      if (existingClusterId !== undefined && existingClusterId !== clusterId) {
        const existing = merged.get(existingClusterId) ?? [];
        existing.forEach((ek) => existingKeys.add(ek));
        clustersToDelete.add(existingClusterId);
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
      if (existingClusterId !== undefined && existingClusterId !== clusterId) {
        const existing = merged.get(existingClusterId) ?? [];
        existing.forEach((ek) => existingKeys.add(ek));
        clustersToDelete.add(existingClusterId);
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
  for (const k of keys) {
    const info = infoMap.get(k);
    if (info && info.syndicationMatches.length > 0) {
      return true;
    }
  }
  return false;
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
      const versionsCorrected = new Set(
        corrections.flatMap((c) => {
          const targetKey = `${c.articleId}::${c.publisher.publisherId}::${c.correctsSourceVersionId}`;
          return members.filter((m) => getRecordKey(m) === targetKey).map((m) => m.sourceVersionId);
        })
      );
      hasConflict = corrections.some((c) => versionsCorrected.has(c.sourceVersionId));
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
    extractedClaims: [...new Set(record.extractedClaims)].sort(),
    warnings: record.warnings
  };
}

export async function clusterNewsEvidence(
  input: ClusterNewsEvidenceInput
): Promise<readonly NewsEvidencePayload[]> {
  const historical = [...input.historical];
  const incoming = [...input.incoming].map((p) => ({ ...p }) as NewsEvidencePayload);

  const incomingKeys = new Set<string>();
  for (const p of incoming) {
    incomingKeys.add(getRecordKey(p));
  }

  const allRecords: NewsEvidencePayload[] = [...historical, ...incoming];

  if (allRecords.length === 0) return [];

  const infoMap = buildRecordInfoMap(allRecords);

  const syndicationClusters = buildSyndicationClusters(allRecords, infoMap);
  const correctionClusters = buildCorrectionClusters(allRecords, infoMap);
  const jaccardClusters = buildJaccardClusters(allRecords, infoMap);

  const mergedClusters = mergeAllClusters(syndicationClusters, correctionClusters, jaccardClusters);

  const resolved = await resolveClusters(mergedClusters, allRecords, infoMap);

  return resolved;
}
