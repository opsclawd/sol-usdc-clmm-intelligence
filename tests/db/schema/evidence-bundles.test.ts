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
    expect(columns).toContain("taxonomySummary");
    expect(columns).toContain("dominantSignalClass");
    expect(columns).toContain("confidence");
    expect(columns).toContain("confidenceComposite");
    expect(columns).toContain("confidenceLevel");
    expect(columns).toContain("validUntilUnixMs");
    expect(columns).toContain("isStale");
    expect(columns).toContain("staleBehavior");
    expect(columns).toContain("provenance");
    expect(columns).toContain("version");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
