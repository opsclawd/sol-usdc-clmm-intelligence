import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0005_publish_attempts.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("publish_attempts migration", () => {
  it("reads the migration file", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
  });

  describe("creates table with correct structure", () => {
    it("creates intelligence.publish_attempts table", () => {
      const sql = readMigration();
      expect(sql).toContain('CREATE TABLE "intelligence"."publish_attempts"');
    });

    it("has all 17 columns defined", () => {
      const sql = readMigration();
      const columns = [
        "id",
        "target",
        "target_endpoint",
        "evidence_bundle_id",
        "research_brief_id",
        "idempotency_key",
        "request_hash",
        "payload_hash",
        "status",
        "http_status",
        "response_body",
        "error_code",
        "error_message",
        "attempt_number",
        "first_attempted_at_unix_ms",
        "completed_at_unix_ms",
        "received_at_unix_ms"
      ];
      for (const col of columns) {
        expect(sql).toContain(`"${col}"`);
      }
    });
  });

  describe("check constraints enforce canonical publish statuses", () => {
    it("has chk_pub_attempt_status check with all 10 statuses", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_status" CHECK');
      expect(sql).toContain("'pending'");
      expect(sql).toContain("'sent'");
      expect(sql).toContain("'created'");
      expect(sql).toContain("'idempotent_replay'");
      expect(sql).toContain("'validation_failed'");
      expect(sql).toContain("'auth_failed'");
      expect(sql).toContain("'conflict'");
      expect(sql).toContain("'store_unavailable'");
      expect(sql).toContain("'network_failed'");
      expect(sql).toContain("'unknown_failed'");
    });

    it("has chk_pub_attempt_http_status check with 100-599 bounds", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_http_status" CHECK');
      expect(sql).toMatch(/http_status.*>= 100/);
      expect(sql).toMatch(/http_status.*<= 599/);
    });
  });

  describe("check constraints enforce valid attempt and timestamp values", () => {
    it("has chk_pub_attempt_number requiring attempt_number > 0", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_number" CHECK');
      expect(sql).toMatch(/attempt_number.*> 0/);
    });

    it("has chk_pub_attempt_first_timestamp requiring non-negative value", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_first_timestamp" CHECK');
      expect(sql).toMatch(/first_attempted_at_unix_ms.*>= 0/);
    });

    it("has chk_pub_attempt_completed_timestamp allowing null or non-negative", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_completed_timestamp" CHECK');
      expect(sql).toMatch(/completed_at_unix_ms.*IS NULL.*>= 0|>= 0.*IS NULL/);
    });

    it("has chk_pub_attempt_received_timestamp requiring non-negative value", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_received_timestamp" CHECK');
      expect(sql).toMatch(/received_at_unix_ms.*>= 0/);
    });

    it("has chk_pub_attempt_completion_order ensuring completed_at >= first_attempted", () => {
      const sql = readMigration();
      expect(sql).toContain('CONSTRAINT "chk_pub_attempt_completion_order" CHECK');
      expect(sql).toMatch(/completed_at_unix_ms.*>=.*first_attempted_at_unix_ms/);
    });
  });

  describe("retry-compatible unique identity", () => {
    it("creates unique index uniq_pub_attempt_idem on target, idempotency_key, and attempt_number", () => {
      const sql = readMigration();
      expect(sql).toMatch(
        /CREATE UNIQUE INDEX "uniq_pub_attempt_idem"[\s\S]*"target"[\s\S]*"idempotency_key"[\s\S]*"attempt_number"/
      );
    });

    it("allows repeated target+idempotency_key with different attempt_number", () => {
      const sql = readMigration();
      const uniqueIndexMatch = sql.match(/CREATE UNIQUE INDEX "uniq_pub_attempt_idem"[^;]+;/);
      expect(uniqueIndexMatch).not.toBeNull();
    });
  });

  describe("indexes for logical bundle and brief references", () => {
    it("creates idx_pub_attempt_bundle on evidence_bundle_id", () => {
      const sql = readMigration();
      expect(sql).toMatch(/CREATE INDEX "idx_pub_attempt_bundle"[\s\S]*"evidence_bundle_id"/);
    });

    it("creates idx_pub_attempt_brief on research_brief_id", () => {
      const sql = readMigration();
      expect(sql).toMatch(/CREATE INDEX "idx_pub_attempt_brief"[\s\S]*"research_brief_id"/);
    });

    it("creates idx_pub_attempt_status_recency on status and received_at_unix_ms", () => {
      const sql = readMigration();
      expect(sql).toMatch(
        /CREATE INDEX "idx_pub_attempt_status_recency"[\s\S]*"status"[\s\S]*"received_at_unix_ms"/
      );
    });

    it("creates idx_pub_attempt_target_idem on target and idempotency_key", () => {
      const sql = readMigration();
      expect(sql).toMatch(
        /CREATE INDEX "idx_pub_attempt_target_idem"[\s\S]*"target"[\s\S]*"idempotency_key"/
      );
    });
  });

  describe("no foreign keys - logical references without cascade", () => {
    it("has no FOREIGN KEY constraints", () => {
      const sql = readMigration();
      expect(sql).not.toMatch(/\bFOREIGN KEY\s*\(/i);
    });

    it("has no REFERENCES to evidence_bundles or research_briefs", () => {
      const sql = readMigration();
      expect(sql).not.toMatch(/\bREFERENCES\s+"intelligence"\."evidence_bundles"/i);
      expect(sql).not.toMatch(/\bREFERENCES\s+"intelligence"\."research_briefs"/i);
      expect(sql).not.toMatch(/\bREFERENCES\s+"evidence_bundles"/i);
      expect(sql).not.toMatch(/\bREFERENCES\s+"research_briefs"/i);
    });

    it("documents intentional logical references without foreign keys", () => {
      const sql = readMigration();
      expect(sql).toContain("intentionally logical references");
    });
  });
});
