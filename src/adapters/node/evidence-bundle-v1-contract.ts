import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Ajv2020Class from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  CanonicalEvidenceBundle,
  EvidenceBundleContract,
  EvidenceBundleContractError
} from "../../contracts/evidence-bundle.js";
import type { EvidenceBundleV1 } from "../../contracts/generated/evidence-bundle-v1.js";

const SCHEMA_VERSION = "evidence-bundle.v1" as const;

const getContractDir = (): string => {
  const candidates = [
    new URL("../../../schemas/regime-engine/evidence-bundle.v1", import.meta.url),
    new URL("../../../../schemas/regime-engine/evidence-bundle.v1", import.meta.url)
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) {
      return path;
    }
  }
  return fileURLToPath(candidates[0]!);
};

const CONTRACT_DIR = getContractDir();

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

async function loadProvenance(): Promise<{
  assets: Array<{ localPath: string; sha256: string }>;
}> {
  const provenancePath = join(CONTRACT_DIR, "provenance.json");
  const content = await readFile(provenancePath, "utf-8");
  return JSON.parse(content) as { assets: Array<{ localPath: string; sha256: string }> };
}

async function loadSchema(): Promise<object> {
  const schemaPath = join(CONTRACT_DIR, "schema.json");
  const content = await readFile(schemaPath, "utf-8");
  return JSON.parse(content) as object;
}

async function verifyAssetHashes(): Promise<void> {
  const provenance = await loadProvenance();
  for (const asset of provenance.assets) {
    const assetPath = join(CONTRACT_DIR, asset.localPath);
    const content = await readFile(assetPath, "utf-8");
    const actualHash = computeSha256(content);
    if (actualHash !== asset.sha256) {
      throw {
        code: "ASSET_HASH_MISMATCH" as const,
        assetPath: asset.localPath,
        expectedHash: asset.sha256,
        actualHash
      };
    }
  }
}

function canonicalizePayload(payload: unknown): string {
  return canonicalizeValue(payload);
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize non-finite number");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeValue).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalizeValue(obj[k]));
    return "{" + entries.join(",") + "}";
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function computePayloadHash(canonical: string): string {
  return computeSha256(canonical);
}

function deriveIdempotencyKey(payload: EvidenceBundleV1): string {
  const identityFields = [
    payload.schemaVersion,
    payload.source.publisher,
    payload.source.sourceId,
    payload.runId,
    payload.correlationId,
    payload.pair,
    payload.scope.kind,
    payload.asOf,
    payload.createdAt
  ];

  if (payload.scope.kind === "whirlpool") {
    identityFields.push(payload.scope.whirlpoolAddress);
  } else if (payload.scope.kind === "wallet") {
    identityFields.push(payload.scope.walletAddress);
  } else if (payload.scope.kind === "position") {
    identityFields.push(
      payload.scope.walletAddress,
      payload.scope.whirlpoolAddress,
      payload.scope.positionId
    );
  }

  const sortedFeatures = [...payload.deterministicFeatures].sort((a, b) =>
    a.featureId.localeCompare(b.featureId)
  );
  for (const feat of sortedFeatures) {
    identityFields.push(feat.featureId, feat.calculator.name, feat.calculator.version);
  }

  const combined = identityFields.filter(Boolean).join("|");
  return computeSha256(combined);
}

export function createEvidenceBundleContract(): EvidenceBundleContract {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ajv: any = null;
  let schema: object | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getAjvAndSchema(): Promise<{ ajv: any; schema: object }> {
    if (!ajv || !schema) {
      await verifyAssetHashes();
      schema = await loadSchema();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ajv = new (Ajv2020Class as any)({ strict: true, allErrors: true });
      ajv.addKeyword({
        keyword: "finite",
        type: "number",
        compile: (schemaVal: boolean) => {
          return (data: unknown) =>
            !schemaVal || (typeof data === "number" && Number.isFinite(data));
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (addFormats as any)(ajv);
      ajv.addSchema(schema);
    }
    return { ajv, schema: schema! };
  }

  return {
    async validateCanonicalizeAndHash(candidate: unknown): Promise<CanonicalEvidenceBundle> {
      const { ajv, schema } = await getAjvAndSchema();

      const schemaVersion = (candidate as Record<string, unknown>)?.schemaVersion;
      if (typeof schemaVersion !== "string" || schemaVersion !== SCHEMA_VERSION) {
        const error: EvidenceBundleContractError = {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          schemaVersion: typeof schemaVersion === "string" ? schemaVersion : "undefined"
        };
        throw error;
      }

      const validate = ajv.compile(schema);
      const valid = validate(candidate);

      if (!valid) {
        const error: EvidenceBundleContractError = {
          code: "VALIDATION_ERROR",
          errors: validate.errors ?? []
        };
        throw error;
      }

      const payload = candidate as EvidenceBundleV1;
      const errors: unknown[] = [];

      // 1. Duplicate featureId check
      const featureIds = new Set<string>();
      for (const feat of payload.deterministicFeatures) {
        if (featureIds.has(feat.featureId)) {
          errors.push({
            message: `Duplicate featureId: ${feat.featureId}`,
            instancePath: "/deterministicFeatures"
          });
        }
        featureIds.add(feat.featureId);
      }

      // 2. Unresolved lineage check
      const sourceRefIds = new Set(payload.sourceReferences.map((r) => r.referenceId));
      for (const feat of payload.deterministicFeatures) {
        for (const ref of feat.inputLineage) {
          if (!sourceRefIds.has(ref) && !featureIds.has(ref)) {
            errors.push({
              message: `Unresolved lineage reference: ${ref}`,
              instancePath: `/deterministicFeatures/${feat.featureId}/inputLineage`
            });
          }
        }
      }

      // 3. Unresolved brief evidence check
      if (payload.researchBrief) {
        const contextualIds = new Set<string>(featureIds);
        const families = payload.contextualEvidence;
        const allClaims = [
          ...(families.supportResistance ?? []),
          ...(families.flows ?? []),
          ...(families.derivatives ?? []),
          ...(families.events ?? []),
          ...(families.newsRegulatory ?? [])
        ];
        for (const claim of allClaims) {
          contextualIds.add(claim.evidenceId);
        }
        for (const ref of payload.researchBrief.sourceEvidenceIds) {
          if (!contextualIds.has(ref)) {
            errors.push({
              message: `Unresolved brief evidence reference: ${ref}`,
              instancePath: "/researchBrief/sourceEvidenceIds"
            });
          }
        }
      }

      // 4. Empty context warning check
      const families = payload.contextualEvidence;
      const isContextEmpty =
        (!families.supportResistance || families.supportResistance.length === 0) &&
        (!families.flows || families.flows.length === 0) &&
        (!families.derivatives || families.derivatives.length === 0) &&
        (!families.events || families.events.length === 0) &&
        (!families.newsRegulatory || families.newsRegulatory.length === 0);

      const warningCodes = new Set(payload.assessment.warnings.map((w) => w.code));
      if (isContextEmpty && payload.researchBrief === null) {
        if (!warningCodes.has("CONTEXTUAL_EVIDENCE_UNAVAILABLE")) {
          errors.push({
            message: "Missing CONTEXTUAL_EVIDENCE_UNAVAILABLE warning",
            instancePath: "/assessment/warnings"
          });
        }
      }
      if (payload.researchBrief === null) {
        if (!warningCodes.has("RESEARCH_BRIEF_UNAVAILABLE")) {
          errors.push({
            message: "Missing RESEARCH_BRIEF_UNAVAILABLE warning",
            instancePath: "/assessment/warnings"
          });
        }
      }

      // 5. Reversed lifecycle check
      if (new Date(payload.asOf) > new Date(payload.freshUntil)) {
        errors.push({
          message: "asOf must be before or equal to freshUntil",
          instancePath: "/freshUntil"
        });
      }
      if (new Date(payload.freshUntil) > new Date(payload.expiresAt)) {
        errors.push({
          message: "freshUntil must be before or equal to expiresAt",
          instancePath: "/expiresAt"
        });
      }
      if (new Date(payload.createdAt) > new Date(payload.expiresAt)) {
        errors.push({
          message: "createdAt must be before or equal to expiresAt",
          instancePath: "/expiresAt"
        });
      }
      for (const feat of payload.deterministicFeatures) {
        if (
          feat.observedAt &&
          feat.freshUntil &&
          new Date(feat.observedAt) > new Date(feat.freshUntil)
        ) {
          errors.push({
            message: "observedAt must be before or equal to freshUntil",
            instancePath: `/deterministicFeatures/${feat.featureId}/freshUntil`
          });
        }
      }

      // 6. Coverage matching checks
      if (
        payload.researchBrief === null &&
        payload.assessment.coverage.researchBrief === "available"
      ) {
        errors.push({
          message: "researchBrief coverage mismatch",
          instancePath: "/assessment/coverage/researchBrief"
        });
      }
      if (
        payload.researchBrief !== null &&
        payload.assessment.coverage.researchBrief !== "available"
      ) {
        errors.push({
          message: "researchBrief coverage mismatch",
          instancePath: "/assessment/coverage/researchBrief"
        });
      }
      const checkCoverage = (
        arr: unknown[] | undefined,
        key: keyof typeof payload.assessment.coverage
      ) => {
        const hasItems = arr && arr.length > 0;
        const coverageVal = payload.assessment.coverage[key];
        if (hasItems && coverageVal !== "available") {
          errors.push({
            message: `${key} coverage mismatch`,
            instancePath: `/assessment/coverage/${key}`
          });
        }
        if (!hasItems && coverageVal === "available") {
          errors.push({
            message: `${key} coverage mismatch`,
            instancePath: `/assessment/coverage/${key}`
          });
        }
      };
      checkCoverage(families.supportResistance, "supportResistance");
      checkCoverage(families.flows, "flows");
      checkCoverage(families.derivatives, "derivatives");
      checkCoverage(families.events, "events");
      checkCoverage(families.newsRegulatory, "newsRegulatory");

      if (errors.length > 0) {
        throw {
          code: "VALIDATION_ERROR" as const,
          errors
        };
      }

      let canonical: string;
      try {
        canonical = canonicalizePayload(candidate);
      } catch (e) {
        const error: EvidenceBundleContractError = {
          code: "CANONICALIZATION_ERROR",
          message: e instanceof Error ? e.message : String(e)
        };
        throw error;
      }

      const payloadHash = computePayloadHash(canonical);
      const idempotencyKey = deriveIdempotencyKey(payload);

      return Object.freeze({
        payload,
        payloadCanonical: canonical,
        payloadHash,
        idempotencyKey,
        schemaVersion: SCHEMA_VERSION
      });
    }
  };
}
