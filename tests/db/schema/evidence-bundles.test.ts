import { describe, it, expect } from "vitest";
import { evidenceBundles } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("evidenceBundles schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(evidenceBundles);
    expect(columns).toContain("id");
    expect(columns).toContain("schemaVersion");
    expect(columns).toContain("pair");
    expect(columns).toContain("asOfUnixMs");
    expect(columns).toContain("expiresAtUnixMs");
    expect(columns).toContain("payload");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("inputLineage");
    expect(columns).toContain("version");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
