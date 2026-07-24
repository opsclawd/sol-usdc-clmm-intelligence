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
  return matches ? matches.sort() : [];
}

function claimsHaveSameStructureButDifferentNumbers(textA: string, textB: string): boolean {
  const numsA = extractNumbers(textA);
  const numsB = extractNumbers(textB);
  if (numsA.length !== numsB.length) return false;
  const normalizedA = textA.replace(/\$?\d+\.?\d*/g, "#");
  const normalizedB = textB.replace(/\$?\d+\.?\d*/g, "#");
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

function computeScopeTokens(
  affectedAssets: readonly string[],
  affectedProtocols: readonly string[],
  affectedJurisdictions: readonly string[]
): string[] {
  return [...affectedAssets, ...affectedProtocols, ...affectedJurisdictions]
    .map((s) => s.toLowerCase())
    .sort();
}

function computeTimeProximity(asOfA: number, asOfB: number): number {
  const diff = Math.abs(asOfA - asOfB);
  if (diff === 0) return 1;
  if (diff >= TIME_WINDOW_MS) return 0;
  return 1 - diff / TIME_WINDOW_MS;
}

function computeContentSimilarity(
  payloadA: NewsEvidencePayload,
  payloadB: NewsEvidencePayload
): number {
  const titleTokensA = normalizeText(payloadA.title);
  const titleTokensB = normalizeText(payloadB.title);
  const claimsTokensA = payloadA.extractedClaims.flatMap(normalizeText);
  const claimsTokensB = payloadB.extractedClaims.flatMap(normalizeText);

  const titleJaccard = computeJaccardIndex(titleTokensA, titleTokensB);
  const claimsJaccard = computeJaccardIndex(claimsTokensA, claimsTokensB);

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
  const scopeJaccard = computeJaccardIndex(scopeA, scopeB);

  const timeProximity = computeTimeProximity(payloadA.asOfUnixMs, payloadB.asOfUnixMs);

  return titleJaccard * 0.2 + claimsJaccard * 0.3 + scopeJaccard * 0.15 + timeProximity * 0.35;
}

function deriveRepresentativeTuple(payload: NewsEvidencePayload): string {
  const titleTokens = normalizeText(payload.title);
  const scopeTokens = computeScopeTokens(
    payload.affectedAssets,
    payload.affectedProtocols,
    payload.affectedJurisdictions
  );
  return [titleTokens.join(" "), scopeTokens.join("|"), payload.asOfUnixMs.toString()].join("::");
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

    const uniqueClaims = [...new Set(members.flatMap((p) => p.extractedClaims))];

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
