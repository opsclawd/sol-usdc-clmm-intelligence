import { describe, it, expect } from "vitest";
import { derivedFeatures } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("derivedFeatures schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(derivedFeatures);
    expect(columns).toContain("id");
    expect(columns).toContain("featureKind");
    expect(columns).toContain("value");
    expect(columns).toContain("structuredPayload");
    expect(columns).toContain("asOfUnixMs");
    expect(columns).toContain("confidence");
    expect(columns).toContain("inputLineage");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
