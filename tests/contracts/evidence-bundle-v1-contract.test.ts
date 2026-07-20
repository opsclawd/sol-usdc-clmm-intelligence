import { describe, it, expect, beforeAll } from "vitest";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import {
  loadValidFixture,
  loadInvalidFixtures,
  loadHashVectors,
  computeSha256,
  canonicalizePayload
} from "../fixtures/evidence-bundle.js";
import type { EvidenceBundleV1 } from "../../src/contracts/generated/evidence-bundle-v1.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

describe("EvidenceBundleV1 Contract", () => {
  let contract: ReturnType<typeof createEvidenceBundleContract>;

  beforeAll(() => {
    contract = createEvidenceBundleContract();
  });

  describe("rejects contract assets whose bytes do not match the provenance manifest", () => {
    it("should verify all asset hashes match provenance", async () => {
      const result = await contract.validateCanonicalizeAndHash(
        await loadValidFixture("deterministic-only")
      );
      expect(result).toBeDefined();
      expect(result.schemaVersion).toBe("evidence-bundle.v1");
    });
  });

  describe("accepts every pinned canonical valid fixture", () => {
    it("should accept deterministic-only fixture", async () => {
      const fixture = await loadValidFixture("deterministic-only");
      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.schemaVersion).toBe("evidence-bundle.v1");
      expect(result.payload).toBeDefined();
    });

    it("should accept contextual fixture", async () => {
      const fixture = await loadValidFixture("contextual");
      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.schemaVersion).toBe("evidence-bundle.v1");
      expect(result.payload).toBeDefined();
    });
  });

  describe("rejects every pinned canonical invalid fixture", () => {
    it("should reject duplicate-lineage fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "duplicate-lineage");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject empty-context-no-warning fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "empty-context-no-warning");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject wrong-schema-version fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "wrong-schema-version");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject unknown-field fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "unknown-field");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject malformed-contextual-family fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "malformed-contextual-family");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject noncanonical-timestamp fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "noncanonical-timestamp");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject null-brief-available-coverage fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "null-brief-available-coverage");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject out-of-range-number fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "out-of-range-number");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject reversed-lifecycle fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "reversed-lifecycle");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject status-value-mismatch fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "status-value-mismatch");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject unsupported-unit fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "unsupported-unit");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject unresolved-lineage fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "unresolved-lineage");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });

    it("should reject unresolved-brief-evidence fixture", async () => {
      const fixtures = await loadInvalidFixtures();
      const fixture = fixtures.find((f) => f.name === "unresolved-brief-evidence");
      if (!fixture) throw new Error("Fixture not found");
      await expect(contract.validateCanonicalizeAndHash(fixture.payload)).rejects.toThrow();
    });
  });

  describe("accepts deterministic-only evidence with empty context and no research brief", () => {
    it("should accept valid deterministic-only bundle", async () => {
      const fixture = (await loadValidFixture("deterministic-only")) as EvidenceBundleV1;
      expect(fixture.researchBrief).toBeNull();
      expect(fixture.contextualEvidence.supportResistance).toHaveLength(0);
      expect(fixture.contextualEvidence.flows).toHaveLength(0);
      expect(fixture.contextualEvidence.derivatives).toHaveLength(0);
      expect(fixture.contextualEvidence.events).toHaveLength(0);
      expect(fixture.contextualEvidence.newsRegulatory).toHaveLength(0);

      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.schemaVersion).toBe("evidence-bundle.v1");
      expect(result.payloadCanonical).toBeDefined();
      expect(result.payloadHash).toBeDefined();
      expect(result.idempotencyKey).toBeDefined();
    });
  });

  describe("canonicalizes and hashes byte-for-byte like Regime Engine", () => {
    it("should match deterministic-only canonical form", async () => {
      const fixture = await loadValidFixture("deterministic-only");
      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.payloadCanonical).toBeDefined();

      const vectors = await loadHashVectors();
      const vector = vectors.find((v) => v.name === "valid/deterministic-only");
      if (vector) {
        expect(result.payloadCanonical).toBe(vector.canonical);
        expect(result.payloadHash).toBe(vector.sha256);
      }
    });

    it("should match contextual canonical form", async () => {
      const fixture = await loadValidFixture("contextual");
      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.payloadCanonical).toBeDefined();

      const vectors = await loadHashVectors();
      const vector = vectors.find((v) => v.name === "valid/contextual");
      if (vector) {
        expect(result.payloadCanonical).toBe(vector.canonical);
        expect(result.payloadHash).toBe(vector.sha256);
      }
    });

    it("should canonicalize primitives correctly per hash vectors", async () => {
      const vectors = await loadHashVectors();

      for (const vector of vectors) {
        if (
          typeof vector.payload === "object" ||
          vector.payload === null ||
          typeof vector.payload === "boolean"
        ) {
          continue;
        }

        const canonical = canonicalizePayload(vector.payload);
        expect(canonical).toBe(vector.canonical);
        expect(computeSha256(canonical)).toBe(vector.sha256);
      }
    });

    it("should produce correct byte length", async () => {
      const fixture = await loadValidFixture("deterministic-only");
      const result = await contract.validateCanonicalizeAndHash(fixture);
      const expectedByteLength = new TextEncoder().encode(result.payloadCanonical).length;

      const vectors = await loadHashVectors();
      const vector = vectors.find((v) => v.name === "valid/deterministic-only");
      if (vector) {
        expect(expectedByteLength).toBe(vector.utf8ByteLength);
      }
    });
  });

  describe("derives the canonical idempotency identity exactly like Regime Engine", () => {
    it("should derive idempotency key from identity fields only", async () => {
      const fixture = (await loadValidFixture("deterministic-only")) as EvidenceBundleV1;
      const result1 = await contract.validateCanonicalizeAndHash(fixture);

      const modifiedFixture = JSON.parse(JSON.stringify(fixture)) as EvidenceBundleV1;
      modifiedFixture.assessment.warnings.push({
        code: "EXTRA_WARNING",
        message: "This should not affect idempotency key",
        affectedFamilies: []
      });

      const result2 = await contract.validateCanonicalizeAndHash(modifiedFixture);
      expect(result1.idempotencyKey).toBe(result2.idempotencyKey);

      const modifiedFixture2 = JSON.parse(JSON.stringify(fixture)) as EvidenceBundleV1;
      modifiedFixture2.deterministicFeatures.push({
        featureId: "extra-feature",
        family: "market_state",
        featureKind: "number",
        status: "available",
        value: 999,
        unit: "usd",
        observedAt: "2024-01-15T10:00:00.000Z",
        freshUntil: "2024-01-15T11:00:00.000Z",
        confidenceBps: 9000,
        calculator: { name: "extra-calc", version: "1.0.0" },
        inputLineage: ["extra-ref"],
        warnings: []
      });
      modifiedFixture2.sourceReferences.push({
        referenceId: "extra-ref",
        sourceType: "api",
        locator: "https://api.example.com/extra",
        publishedAt: null,
        observedAt: "2024-01-15T09:59:00.000Z",
        contentHash: null
      });

      const result3 = await contract.validateCanonicalizeAndHash(modifiedFixture2);
      expect(result1.idempotencyKey).not.toBe(result3.idempotencyKey);
    });
  });

  describe("rejects unsupported schema versions before canonicalization", () => {
    it("should reject arbitrary schema version", async () => {
      const fixture = (await loadValidFixture("deterministic-only")) as EvidenceBundleV1;
      const modifiedFixture = { ...fixture, schemaVersion: "evidence-bundle.v2" };
      await expect(contract.validateCanonicalizeAndHash(modifiedFixture)).rejects.toThrow();
    });

    it("should reject undefined schema version", async () => {
      const fixture = (await loadValidFixture("deterministic-only")) as EvidenceBundleV1;
      const modifiedFixture = { ...fixture, schemaVersion: undefined };
      await expect(contract.validateCanonicalizeAndHash(modifiedFixture)).rejects.toThrow();
    });

    it("should reject null schema version", async () => {
      const fixture = (await loadValidFixture("deterministic-only")) as EvidenceBundleV1;
      const modifiedFixture = { ...fixture, schemaVersion: null };
      await expect(contract.validateCanonicalizeAndHash(modifiedFixture)).rejects.toThrow();
    });
  });

  describe("generated contract type is deterministic and matches checked-in file", () => {
    it("should regenerate identical bytes to checked-in file", () => {
      const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
      const checkedInPath = join(repoRoot, "src/contracts/generated/evidence-bundle-v1.ts");

      execSync("pnpm contract:evidence-bundle:generate", { cwd: repoRoot });

      const regenerated = readFileSync(
        join(repoRoot, "src/contracts/generated/evidence-bundle-v1.ts"),
        "utf-8"
      );
      const checkedIn = readFileSync(checkedInPath, "utf-8");

      expect(regenerated).toBe(checkedIn);
    });
  });
});
