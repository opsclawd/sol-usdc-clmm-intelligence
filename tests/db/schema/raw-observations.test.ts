import { describe, it, expect } from "vitest";
import { rawObservations } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("rawObservations schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(rawObservations);
    expect(columns).toContain("id");
    expect(columns).toContain("source");
    expect(columns).toContain("sourceObservationKey");
    expect(columns).toContain("observedAtUnixMs");
    expect(columns).toContain("fetchedAtUnixMs");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("payloadCanonical");
    expect(columns).toContain("parseStatus");
    expect(columns).toContain("sourceRequestMeta");
    expect(columns).toContain("receivedAtUnixMs");
  });

  it("sourceObservationKey is nullable in schema", () => {
    expect(rawObservations.sourceObservationKey.notNull).toBe(false);
  });
});
