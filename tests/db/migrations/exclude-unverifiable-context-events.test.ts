import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const MIGRATION_PATH = resolve("drizzle/0010_exclude_unverifiable_context_events.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("0010_exclude_unverifiable_context_events migration contract", () => {
  it("deletes only solana status normalized rows with mismatched raw provenance hashes", () => {
    const rawSql = readMigration();
    const sql = normalizeSql(rawSql);

    // Candidate selection joins normalized_observations.raw_observation_id to raw_observations.id
    expect(sql).toMatch(/normalized_observations/i);
    expect(sql).toMatch(/raw_observations/i);
    expect(sql).toMatch(/raw_observation_id/i);

    // Selection requires ro.source = 'solana-status-api'
    expect(sql).toMatch(/solana-status-api/i);

    // JSONB expansion over provenance->'sourceRefs' with refType = 'raw_observation'
    expect(sql).toMatch(/provenance\s*->\s*'?sourceRefs'?/i);
    expect(sql).toMatch(/raw_observation/i);

    // Referenced payloadHash unequal to ro.payload_hash
    expect(sql).toMatch(/payloadHash/i);
    expect(sql).toMatch(/payload_hash/i);
    expect(sql).toMatch(/(<>|!=)/);
  });

  it("aborts before deletion when a derived feature references a candidate normalized row", () => {
    const rawSql = readMigration();
    const sql = normalizeSql(rawSql);

    // Pre-delete guard checks candidate IDs against derived_features.input_observation_ids
    expect(sql).toMatch(/derived_features/i);
    expect(sql).toMatch(/input_observation_ids/i);

    // Guard raises an exception if any candidate is referenced
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);

    // The guard appears before the delete statement
    const raiseIdx = sql.search(/RAISE\s+EXCEPTION/i);
    const deleteIdx = sql.search(/DELETE\s+FROM/i);
    expect(raiseIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(raiseIdx).toBeLessThan(deleteIdx);
  });

  it("retains raw observations when unverifiable normalized rows are excluded", () => {
    const rawSql = readMigration();
    const sql = normalizeSql(rawSql);

    // The only DELETE target is intelligence.normalized_observations
    expect(sql).toMatch(/DELETE\s+FROM\s+("?intelligence"?\.)?"?normalized_observations"?/i);

    // Never DELETE from raw_observations, derived_features, evidence_bundles, or research_briefs
    expect(sql).not.toMatch(/DELETE\s+FROM\s+("?intelligence"?\.)?"?raw_observations"?/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+("?intelligence"?\.)?"?derived_features"?/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+("?intelligence"?\.)?"?evidence_bundles"?/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+("?intelligence"?\.)?"?research_briefs"?/i);
  });
});
