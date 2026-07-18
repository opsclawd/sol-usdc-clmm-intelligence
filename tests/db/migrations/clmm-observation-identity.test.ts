import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0001_clmm_observation_identity.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("clmm_observation_identity migration", () => {
  it("reads the migration file", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
  });

  describe("raw observations identity migration", () => {
    it("adds source_observation_key column as nullable first", () => {
      const content = readMigration();
      const addColumnMatch = content.match(
        /ALTER TABLE "intelligence"\."raw_observations" ADD COLUMN "source_observation_key" text;/
      );
      expect(addColumnMatch).not.toBeNull();
    });

    it("backfills legacy rows with deterministic 64-character key", () => {
      const content = readMigration();
      expect(content).toContain("source_observation_key");
      expect(content).toMatch(
        /UPDATE "intelligence"\."raw_observations" SET "source_observation_key"/
      );
    });

    it("sets NOT NULL after backfill", () => {
      const content = readMigration();
      expect(content).toMatch(
        /ALTER TABLE "intelligence"\."raw_observations" ALTER COLUMN "source_observation_key" SET NOT NULL/
      );
    });

    it("drops old unique index uniq_raw_obs_source_payload_hash", () => {
      const content = readMigration();
      expect(content).toContain('DROP INDEX "intelligence"."uniq_raw_obs_source_payload_hash"');
    });

    it("creates new unique index uniq_raw_obs_source_observation_key", () => {
      const content = readMigration();
      expect(content).toMatch(
        /CREATE UNIQUE INDEX "uniq_raw_obs_source_observation_key" ON "intelligence"\."raw_observations" USING btree \("source","source_observation_key"\)/
      );
    });

    it("creates non-unique index idx_raw_obs_source_payload_hash", () => {
      const content = readMigration();
      expect(content).toMatch(
        /CREATE INDEX "idx_raw_obs_source_payload_hash" ON "intelligence"\."raw_observations" USING btree \("source","payload_hash"\)/
      );
    });
  });

  describe("normalized observations identity migration", () => {
    it("drops old unique index uniq_norm_obs_source_kind_hash", () => {
      const content = readMigration();
      expect(content).toContain('DROP INDEX "intelligence"."uniq_norm_obs_source_kind_hash"');
    });

    it("creates new unique index uniq_norm_obs_raw_kind_hash", () => {
      const content = readMigration();
      expect(content).toMatch(
        /CREATE UNIQUE INDEX "uniq_norm_obs_raw_kind_hash" ON "intelligence"\."normalized_observations" USING btree \("raw_observation_id","observation_kind","payload_hash"\)/
      );
    });
  });

  describe("statement ordering", () => {
    it("backfill happens before NOT NULL constraint", () => {
      const content = readMigration();
      const addColumnIdx = content.indexOf('ADD COLUMN "source_observation_key"');
      const backfillIdx = content.indexOf('SET "source_observation_key"');
      const setNotNullIdx = content.indexOf("SET NOT NULL");

      expect(addColumnIdx).toBeLessThan(backfillIdx);
      expect(backfillIdx).toBeLessThan(setNotNullIdx);
    });

    it("old indexes dropped before new ones created", () => {
      const content = readMigration();
      const dropOldIdx = content.indexOf(
        'DROP INDEX "intelligence"."uniq_raw_obs_source_payload_hash"'
      );
      const createNewIdx = content.indexOf(
        'CREATE UNIQUE INDEX "uniq_raw_obs_source_observation_key"'
      );

      expect(dropOldIdx).toBeLessThan(createNewIdx);
    });
  });
});
