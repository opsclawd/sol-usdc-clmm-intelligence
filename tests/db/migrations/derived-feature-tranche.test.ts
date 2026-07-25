import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0002_derived_feature_tranche.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("derived_feature_tranche migration", () => {
  it("reads the migration file", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
  });

  describe("precondition check", () => {
    it("aborts migration when historical derived feature rows exist", () => {
      const content = readMigration();
      expect(content).toContain("IF NOT (0 + (SELECT COUNT(*)::bigint FROM");
      expect(content).toContain("RAISE EXCEPTION");
      expect(content).toContain("Migration aborted");
    });

    it("never deletes or rewrites historical rows", () => {
      const content = readMigration();
      expect(content).not.toMatch(/DELETE FROM "intelligence"\."derived_features"/);
      expect(content).not.toMatch(/UPDATE "intelligence"\."derived_features" SET/);
      expect(content).not.toMatch(/TRUNCATE "intelligence"\."derived_features"/);
    });
  });

  describe("new columns", () => {
    it("adds status column as nullable first then NOT NULL", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "status" varchar\(16\)/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "status" SET NOT NULL/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_status" CHECK \("status" IN \('AVAILABLE', 'PARTIAL', 'UNAVAILABLE'\)/
      );
    });

    it("adds unit column as nullable first then NOT NULL", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "unit" varchar\(8\)/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "unit" SET NOT NULL/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit" CHECK \("unit" IN \('BPS', 'PPM'\)/
      );
    });

    it("adds pair column with default SOL/USDC", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "pair" varchar\(32\) DEFAULT 'SOL\/USDC'/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "pair" SET NOT NULL/
      );
    });

    it("adds calculator_version column", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "calculator_version" varchar\(32\)/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "calculator_version" SET NOT NULL/
      );
    });

    it("adds selection_version column", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "selection_version" varchar\(32\)/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "selection_version" SET NOT NULL/
      );
    });

    it("adds input_observation_ids as integer array", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "input_observation_ids" integer\[\] DEFAULT '\{\}'/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "input_observation_ids" SET NOT NULL/
      );
    });

    it("adds rejected_observation_ids as integer array", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "rejected_observation_ids" integer\[\] DEFAULT '\{\}'/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "rejected_observation_ids" SET NOT NULL/
      );
    });

    it("adds derivation_key column", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "derivation_key" varchar\(128\)/
      );
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ALTER COLUMN "derivation_key" SET NOT NULL/
      );
    });

    it("adds pool_id column as nullable", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "pool_id" varchar\(64\)/
      );
    });

    it("adds position_id column as nullable", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."derived_features" ADD COLUMN "position_id" varchar\(64\)/
      );
    });
  });

  describe("structured_payload becomes NOT NULL", () => {
    it("sets structured_payload NOT NULL after other alterations", () => {
      const content = readMigration();
      const setNotNullIdx = content.indexOf(
        'ALTER TABLE "intelligence"."derived_features" ALTER COLUMN "structured_payload" SET NOT NULL'
      );
      expect(setNotNullIdx).toBeGreaterThan(0);
    });
  });

  describe("feature kind constraints", () => {
    it("adds exact seven-kind allowlist check", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_kind_allowlist" CHECK \("feature_kind" IN \('range_location', 'distance_to_lower', 'distance_to_upper', 'oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h', 'volume_liquidity_ratio_24h'\)/
      );
    });
  });

  describe("status-value coherence constraints", () => {
    it("unavailable requires null value", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_status_value" CHECK \(\("status" = 'UNAVAILABLE' AND "value" IS NULL\) OR \("status" <> 'UNAVAILABLE' AND "value" IS NOT NULL\)/
      );
    });
  });

  describe("unit-kind constraints", () => {
    it("BPS kinds require BPS unit", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_bps" CHECK \(\("feature_kind" = 'oracle_dex_divergence' AND "unit" = 'BPS'\) OR \("feature_kind" <> 'oracle_dex_divergence'\)/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_bps2" CHECK \(\("feature_kind" = 'oracle_confidence_width' AND "unit" = 'BPS'\) OR \("feature_kind" <> 'oracle_confidence_width'\)/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_bps3" CHECK \(\("feature_kind" = 'realized_volatility_1h' AND "unit" = 'BPS'\) OR \("feature_kind" <> 'realized_volatility_1h'\)/
      );
    });

    it("PPM kinds require PPM unit", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_ppm" CHECK \(\("feature_kind" = 'range_location' AND "unit" = 'PPM'\) OR \("feature_kind" <> 'range_location'\)/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_ppm2" CHECK \(\("feature_kind" = 'distance_to_lower' AND "unit" = 'PPM'\) OR \("feature_kind" <> 'distance_to_lower'\)/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_ppm3" CHECK \(\("feature_kind" = 'distance_to_upper' AND "unit" = 'PPM'\) OR \("feature_kind" <> 'distance_to_upper'\)/
      );
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_unit_ppm4" CHECK \(\("feature_kind" = 'volume_liquidity_ratio_24h' AND "unit" = 'PPM'\) OR \("feature_kind" <> 'volume_liquidity_ratio_24h'\)/
      );
    });
  });

  describe("scope identity constraints", () => {
    it("position kinds require both pool_id and position_id", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_scope_position" CHECK \(\(\("feature_kind" IN \('range_location', 'distance_to_lower', 'distance_to_upper'\) AND "pool_id" IS NOT NULL AND "position_id" IS NOT NULL\) OR \("feature_kind" NOT IN \('range_location', 'distance_to_lower', 'distance_to_upper'\)\)/
      );
    });

    it("volume_liquidity_ratio_24h requires pool_id and no position_id", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_scope_volume" CHECK \(\(\("feature_kind" = 'volume_liquidity_ratio_24h' AND "pool_id" IS NOT NULL AND "position_id" IS NULL\) OR \("feature_kind" <> 'volume_liquidity_ratio_24h'\)/
      );
    });

    it("other kinds require neither pool_id nor position_id", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ADD CONSTRAINT "chk_features_scope_other" CHECK \(\(\("feature_kind" IN \('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h'\) AND "pool_id" IS NULL AND "position_id" IS NULL\) OR \("feature_kind" NOT IN \('oracle_dex_divergence', 'oracle_confidence_width', 'realized_volatility_1h'\)/
      );
    });
  });

  describe("index changes", () => {
    it("drops old unique index uniq_features_kind_hash", () => {
      const content = readMigration();
      expect(content).toContain('DROP INDEX "intelligence"."uniq_features_kind_hash"');
    });

    it("creates new unique index uniq_features_kind_derivation_key", () => {
      const content = readMigration();
      expect(content).toMatch(
        /CREATE UNIQUE INDEX "uniq_features_kind_derivation_key" ON "intelligence"\."derived_features" USING btree \("feature_kind", "derivation_key"\)/
      );
    });
  });

  describe("statement ordering", () => {
    it("precondition check happens before any schema mutations", () => {
      const content = readMigration();
      const preconditionIdx = content.indexOf("IF NOT (0 + (SELECT COUNT");
      const firstAlterIdx = content.indexOf("ALTER TABLE");
      expect(preconditionIdx).toBeLessThan(firstAlterIdx);
    });

    it("drops old index before creating new one", () => {
      const content = readMigration();
      const dropIdx = content.indexOf('DROP INDEX "intelligence"."uniq_features_kind_hash"');
      const createIdx = content.indexOf('CREATE UNIQUE INDEX "uniq_features_kind_derivation_key"');
      expect(dropIdx).toBeLessThan(createIdx);
    });
  });
});
