import { describe, it, expect } from "vitest";
import { getColumnNames } from "../schema-helpers.js";
import { publishAttempts } from "../../../src/db/schema/index.js";
import { getTableConfig as drizzleGetTableConfig } from "drizzle-orm/pg-core";

const REQUIRED_COLUMNS = [
  "id",
  "target",
  "targetEndpoint",
  "evidenceBundleId",
  "researchBriefId",
  "idempotencyKey",
  "requestHash",
  "payloadHash",
  "status",
  "httpStatus",
  "responseBody",
  "errorCode",
  "errorMessage",
  "attemptNumber",
  "firstAttemptedAtUnixMs",
  "completedAtUnixMs",
  "receivedAtUnixMs"
] as const;

const NULLABLE_COLUMNS = [
  "researchBriefId",
  "httpStatus",
  "responseBody",
  "errorCode",
  "errorMessage",
  "completedAtUnixMs"
] as const;

const NOT_NULL_COLUMNS = REQUIRED_COLUMNS.filter(
  (c) => !NULLABLE_COLUMNS.includes(c as (typeof NULLABLE_COLUMNS)[number])
);

function getIndexColumnNames(columns: Array<{ name?: string }>): string[] {
  return columns.map((c) => c.name || "").filter(Boolean);
}

describe("publishAttempts schema", () => {
  it("has all 17 required columns", () => {
    const columns = getColumnNames(publishAttempts);
    for (const col of REQUIRED_COLUMNS) {
      expect(columns).toContain(col);
    }
    expect(columns.length).toBe(REQUIRED_COLUMNS.length);
  });

  it("belongs to intelligence schema and is named publish_attempts", () => {
    const config = drizzleGetTableConfig(publishAttempts);
    expect(config.schema).toBe("intelligence");
    expect(config.name).toBe("publish_attempts");
  });

  describe("nullability constraints", () => {
    for (const colName of NOT_NULL_COLUMNS) {
      it(`${colName} is NOT NULL`, () => {
        const col = (publishAttempts as unknown as Record<string, Record<string, unknown>>)[
          colName
        ];
        expect(col).toBeDefined();
        expect(col["notNull"]).toBe(true);
      });
    }

    for (const colName of NULLABLE_COLUMNS) {
      it(`${colName} is nullable`, () => {
        const col = (publishAttempts as unknown as Record<string, Record<string, unknown>>)[
          colName
        ];
        expect(col).toBeDefined();
        expect(col["notNull"]).not.toBe(true);
      });
    }
  });

  describe("unique index for retry-compatible identity", () => {
    it("has unique index named uniq_pub_attempt_idem on target, idempotency_key, and attempt_number", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      const uniqueIdemIndex = config.indexes.find(
        (idx) => idx.config.name === "uniq_pub_attempt_idem"
      );
      expect(uniqueIdemIndex).toBeDefined();
      expect(uniqueIdemIndex!.config.unique).toBe(true);
      const colNames = getIndexColumnNames(
        uniqueIdemIndex!.config.columns as Array<{ name?: string }>
      );
      expect(colNames).toContain("target");
      expect(colNames).toContain("idempotency_key");
      expect(colNames).toContain("attempt_number");
    });
  });

  describe("indexes for logical references", () => {
    it("has idx_pub_attempt_bundle on evidence_bundle_id", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      const bundleIdx = config.indexes.find((idx) => idx.config.name === "idx_pub_attempt_bundle");
      expect(bundleIdx).toBeDefined();
      const colNames = getIndexColumnNames(bundleIdx!.config.columns as Array<{ name?: string }>);
      expect(colNames).toContain("evidence_bundle_id");
    });

    it("has idx_pub_attempt_brief on research_brief_id", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      const briefIdx = config.indexes.find((idx) => idx.config.name === "idx_pub_attempt_brief");
      expect(briefIdx).toBeDefined();
      const colNames = getIndexColumnNames(briefIdx!.config.columns as Array<{ name?: string }>);
      expect(colNames).toContain("research_brief_id");
    });

    it("has idx_pub_attempt_status_recency on status and received_at_unix_ms", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      const statusIdx = config.indexes.find(
        (idx) => idx.config.name === "idx_pub_attempt_status_recency"
      );
      expect(statusIdx).toBeDefined();
      const colNames = getIndexColumnNames(statusIdx!.config.columns as Array<{ name?: string }>);
      expect(colNames).toContain("status");
      expect(colNames).toContain("received_at_unix_ms");
    });

    it("has idx_pub_attempt_target_idem on target and idempotency_key", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      const targetIdemIdx = config.indexes.find(
        (idx) => idx.config.name === "idx_pub_attempt_target_idem"
      );
      expect(targetIdemIdx).toBeDefined();
      const colNames = getIndexColumnNames(
        targetIdemIdx!.config.columns as Array<{ name?: string }>
      );
      expect(colNames).toContain("target");
      expect(colNames).toContain("idempotency_key");
    });
  });

  describe("no foreign keys", () => {
    it("has no foreign keys in table config", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.foreignKeys).toBeDefined();
      expect(config.foreignKeys.length).toBe(0);
    });
  });

  describe("check constraints", () => {
    it("has chk_pub_attempt_status check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_status")).toBe(true);
    });

    it("has chk_pub_attempt_http_status check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_http_status")).toBe(true);
    });

    it("has chk_pub_attempt_number check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_number")).toBe(true);
    });

    it("has chk_pub_attempt_first_timestamp check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_first_timestamp")).toBe(true);
    });

    it("has chk_pub_attempt_completed_timestamp check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_completed_timestamp")).toBe(
        true
      );
    });

    it("has chk_pub_attempt_received_timestamp check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_received_timestamp")).toBe(true);
    });

    it("has chk_pub_attempt_completion_order check", () => {
      const config = drizzleGetTableConfig(publishAttempts);
      expect(config.checks.some((c) => c.name === "chk_pub_attempt_completion_order")).toBe(true);
    });
  });
});
