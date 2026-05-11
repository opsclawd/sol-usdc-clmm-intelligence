import { describe, it, expect } from "vitest";
import { researchBriefs } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("researchBriefs schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(researchBriefs);
    expect(columns).toContain("id");
    expect(columns).toContain("evidenceBundleId");
    expect(columns).toContain("promptVersion");
    expect(columns).toContain("modelProvider");
    expect(columns).toContain("structuredOutput");
    expect(columns).toContain("confidence");
    expect(columns).toContain("sourceRefs");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
