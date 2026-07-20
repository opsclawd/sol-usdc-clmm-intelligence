import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0003_evidence_bundle_v1.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("evidence_bundle_v1 migration", () => {
  it("reads the migration file", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
  });

  describe("aborts before schema mutation when historical bundles exist", () => {
    it("contains precondition check that raises exception on existing rows", () => {
      const content = readMigration();
      expect(content).toContain("IF NOT (0 + (SELECT COUNT(*)::bigint FROM");
      expect(content).toContain("RAISE EXCEPTION");
      expect(content).toContain("Migration aborted");
    });

    it("checks evidence_bundles table specifically", () => {
      const content = readMigration();
      expect(content).toContain('FROM "intelligence"."evidence_bundles"');
    });

    it("aborts before any ALTER TABLE statements", () => {
      const content = readMigration();
      const preconditionIdx = content.indexOf("IF NOT (0 + (SELECT COUNT");
      const firstAlterIdx = content.indexOf("ALTER TABLE");
      expect(preconditionIdx).toBeLessThan(firstAlterIdx);
    });
  });

  describe("never deletes rewrites or truncates historical bundles", () => {
    it("contains no DELETE statements on evidence_bundles", () => {
      const content = readMigration();
      expect(content).not.toMatch(/DELETE FROM "intelligence"\."evidence_bundles"/);
    });

    it("contains no UPDATE statements on evidence_bundles", () => {
      const content = readMigration();
      expect(content).not.toMatch(/UPDATE "intelligence"\."evidence_bundles" SET/);
    });

    it("contains no TRUNCATE statements on evidence_bundles", () => {
      const content = readMigration();
      expect(content).not.toMatch(/TRUNCATE "intelligence"\."evidence_bundles"/);
    });
  });

  describe("stores exact canonical payload text and idempotency identity as required fields", () => {
    it("adds payloadCanonical as text NOT NULL", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ADD COLUMN "payload_canonical" text/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ALTER COLUMN "payload_canonical" SET NOT NULL/
      );
    });

    it("adds idempotencyKey as varchar NOT NULL", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ADD COLUMN "idempotency_key" varchar/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ALTER COLUMN "idempotency_key" SET NOT NULL/
      );
    });
  });

  describe("enforces one immutable row per canonical logical identity", () => {
    it("drops old uniq_bundle_pair_hash index", () => {
      const content = readMigration();
      expect(content).toContain('DROP INDEX "intelligence"."uniq_bundle_pair_hash"');
    });

    it("creates new unique index on schema/source/idempotency", () => {
      const content = readMigration();
      expect(content).toMatch(
        /CREATE UNIQUE INDEX "uniq_bundle_source_idem" ON "intelligence"\."evidence_bundles" USING btree \("schema_version", "pair", "idempotency_key"\)/
      );
    });
  });

  describe("retains payload hash and inspectable jsonb", () => {
    it("does not drop or alter payload_hash column", () => {
      const content = readMigration();
      expect(content).not.toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" DROP COLUMN "payload_hash"/
      );
      expect(content).not.toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ALTER COLUMN "payload_hash"/
      );
    });

    it("does not drop or alter payload column", () => {
      const content = readMigration();
      expect(content).not.toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" DROP COLUMN "payload"/
      );
      expect(content).not.toMatch(
        /ALTER TABLE "intelligence"\."evidence_bundles" ALTER COLUMN "payload"/
      );
    });
  });

  describe("applies constraints only after the historical-row precondition", () => {
    it("precondition check is first statement before all mutations", () => {
      const content = readMigration();
      const preconditionIdx = content.indexOf("IF NOT (0 + (SELECT COUNT");
      const firstStatementBreakpoint = content.indexOf("--> statement-breakpoint");
      expect(preconditionIdx).toBeLessThan(firstStatementBreakpoint);
    });

    it("all ALTER TABLE statements come after precondition", () => {
      const content = readMigration();
      const preconditionIdx = content.indexOf("IF NOT (0 + (SELECT COUNT");
      const alterIdx = content.indexOf("ALTER TABLE");
      expect(preconditionIdx).toBeLessThan(alterIdx);
    });
  });

  describe("statement ordering", () => {
    it("drops old index before creating new one", () => {
      const content = readMigration();
      const dropIdx = content.indexOf('DROP INDEX "intelligence"."uniq_bundle_pair_hash"');
      const createIdx = content.indexOf('CREATE UNIQUE INDEX "uniq_bundle_source_idem"');
      expect(dropIdx).toBeLessThan(createIdx);
    });
  });
});
