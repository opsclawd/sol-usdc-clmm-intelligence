import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0007_perp_liquidation_feature_kinds.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

describe("perp_liquidation_feature_kinds migration", () => {
  it("broadens feature checks without rewriting historical rows", () => {
    const content = readMigration();
    expect(content.length).toBeGreaterThan(0);
    expect(content).not.toMatch(/DELETE FROM/i);
    expect(content).not.toMatch(/UPDATE /i);
    expect(content).not.toMatch(/TRUNCATE/i);

    expect(content).toContain("chk_features_kind_allowlist");
    expect(content).toContain("oi_trend_4h");
    expect(content).toContain("funding_rate_annualized");
    expect(content).toContain("liquidation_cluster_1h");
    expect(content).toContain("basis_spread_bps");
  });
});
