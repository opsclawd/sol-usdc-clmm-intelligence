import { describe, it, expect } from "vitest";
import { normalizedObservations } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("normalizedObservations schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(normalizedObservations);
    expect(columns).toContain("id");
    expect(columns).toContain("rawObservationId");
    expect(columns).toContain("source");
    expect(columns).toContain("observationKind");
    expect(columns).toContain("signalClass");
    expect(columns).toContain("evidenceFamily");
    expect(columns).toContain("payload");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("confidence");
    expect(columns).toContain("confidenceComposite");
    expect(columns).toContain("confidenceLevel");
    expect(columns).toContain("validUntilUnixMs");
    expect(columns).toContain("isStale");
    expect(columns).toContain("staleBehavior");
    expect(columns).toContain("provenance");
    expect(columns).toContain("receivedAtUnixMs");
  });
});
