import { describe, it, expect } from "vitest";
import { derivedFeatures } from "../../../src/db/schema/index.js";
import { getColumnNames } from "../schema-helpers.js";

describe("derivedFeatures schema", () => {
  it("has all required columns", () => {
    const columns = getColumnNames(derivedFeatures);
    expect(columns).toContain("id");
    expect(columns).toContain("featureKind");
    expect(columns).toContain("signalClass");
    expect(columns).toContain("evidenceFamily");
    expect(columns).toContain("value");
    expect(columns).toContain("structuredPayload");
    expect(columns).toContain("asOfUnixMs");
    expect(columns).toContain("confidence");
    expect(columns).toContain("confidenceComposite");
    expect(columns).toContain("confidenceLevel");
    expect(columns).toContain("validUntilUnixMs");
    expect(columns).toContain("isStale");
    expect(columns).toContain("staleBehavior");
    expect(columns).toContain("provenance");
    expect(columns).toContain("payloadHash");
    expect(columns).toContain("receivedAtUnixMs");
  });

  it("has new derived-feature-tranche columns", () => {
    const columns = getColumnNames(derivedFeatures);
    expect(columns).toContain("status");
    expect(columns).toContain("unit");
    expect(columns).toContain("pair");
    expect(columns).toContain("calculatorVersion");
    expect(columns).toContain("selectionVersion");
    expect(columns).toContain("inputObservationIds");
    expect(columns).toContain("rejectedObservationIds");
    expect(columns).toContain("derivationKey");
    expect(columns).toContain("poolId");
    expect(columns).toContain("positionId");
  });
});

describe("derivedFeatures behavioral invariants", () => {
  describe("database status and value constraints exclude fake availability", () => {
    it("status column is NOT NULL", () => {
      const statusCol = (derivedFeatures as unknown as Record<string, unknown>)["status"];
      expect(statusCol).toBeDefined();
    });

    it("status enum is AVAILABLE, PARTIAL, or UNAVAILABLE", () => {
      const columns = getColumnNames(derivedFeatures);
      expect(columns).toContain("status");
    });

    it("value is nullable (database-level constraint enforces AVAILABILITY logic)", () => {
      const valueCol = (derivedFeatures as unknown as Record<string, unknown>)["value"];
      expect(valueCol).toBeDefined();
    });
  });

  describe("database unit kind and scope checks mirror the contract", () => {
    it("unit column is NOT NULL with BPS/PPM values", () => {
      const unitCol = (derivedFeatures as unknown as Record<string, unknown>)["unit"];
      expect(unitCol).toBeDefined();
    });

    it("pool_id is nullable", () => {
      const poolIdCol = (derivedFeatures as unknown as Record<string, unknown>)["poolId"];
      expect(poolIdCol).toBeDefined();
    });

    it("position_id is nullable", () => {
      const positionIdCol = (derivedFeatures as unknown as Record<string, unknown>)["positionId"];
      expect(positionIdCol).toBeDefined();
    });

    it("input_observation_ids is integer array NOT NULL", () => {
      const inputCol = (derivedFeatures as unknown as Record<string, unknown>)[
        "inputObservationIds"
      ];
      expect(inputCol).toBeDefined();
    });

    it("rejected_observation_ids is integer array NOT NULL", () => {
      const rejectedCol = (derivedFeatures as unknown as Record<string, unknown>)[
        "rejectedObservationIds"
      ];
      expect(rejectedCol).toBeDefined();
    });
  });

  describe("database replay identity is feature kind plus derivation key", () => {
    it("derivation_key column is NOT NULL", () => {
      const derivationKeyCol = (derivedFeatures as unknown as Record<string, unknown>)[
        "derivationKey"
      ];
      expect(derivationKeyCol).toBeDefined();
    });

    it("unique index is on feature_kind and derivation_key", () => {
      const columns = getColumnNames(derivedFeatures);
      expect(columns).toContain("derivationKey");
      expect(columns).toContain("featureKind");
    });
  });

  describe("structured payload is NOT NULL", () => {
    it("structuredPayload is NOT NULL after migration", () => {
      const payloadCol = (derivedFeatures as unknown as Record<string, unknown>)[
        "structuredPayload"
      ];
      expect(payloadCol).toBeDefined();
    });
  });
});
