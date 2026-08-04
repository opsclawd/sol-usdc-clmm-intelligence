import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0008_convert_ppm_to_bps.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("convert_ppm_to_bps migration", () => {
  it("reads the migration file", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
  });

  it("updates existing PPM records to BPS", () => {
    const content = readMigration();
    expect(content).toMatch(
      /UPDATE "intelligence"\."derived_features" SET "unit" = 'BPS' WHERE "unit" = 'PPM'/
    );
  });

  it("drops old PPM check constraints if present", () => {
    const content = readMigration();
    expect(content).toContain('DROP CONSTRAINT IF EXISTS "chk_features_unit_ppm"');
    expect(content).toContain('DROP CONSTRAINT IF EXISTS "chk_features_unit_ppm2"');
    expect(content).toContain('DROP CONSTRAINT IF EXISTS "chk_features_unit_ppm3"');
    expect(content).toContain('DROP CONSTRAINT IF EXISTS "chk_features_unit_ppm4"');
  });

  it("adds new BPS check constraints for range location and distance features", () => {
    const content = readMigration();
    expect(content).toContain("chk_features_unit_bps8");
    expect(content).toContain("chk_features_unit_bps9");
    expect(content).toContain("chk_features_unit_bps10");
    expect(content).toContain("chk_features_unit_bps11");
  });

  it("ensures UPDATE happens before adding new check constraints", () => {
    const content = readMigration();
    const updateIdx = content.indexOf(
      'UPDATE "intelligence"."derived_features" SET "unit" = \'BPS\''
    );
    const addConstraintIdx = content.indexOf('ADD CONSTRAINT "chk_features_unit_bps9"');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(addConstraintIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(addConstraintIdx);
  });
});
