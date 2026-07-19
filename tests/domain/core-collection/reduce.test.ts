import { describe, it, expect } from "vitest";
import {
  reduceCoreCollectionStatus,
  countCoreCollectionOutcomes,
  orderCoreWarnings
} from "../../../src/domain/core-collection/reduce.js";
import type {
  SourceCollectionOutcome,
  SourceWarning
} from "../../../src/contracts/collection-run.js";
import type { Freshness } from "../../../src/contracts/taxonomy.js";

// Helper to create a basic mock outcome
function createOutcome(overrides: Partial<SourceCollectionOutcome>): SourceCollectionOutcome {
  return {
    sourceKey: "clmm-v2",
    source: "clmm-v2-bundle",
    status: "accepted",
    hasUsableEvidence: true,
    rawObservationId: null,
    normalizedCount: 1,
    warnings: [],
    freshness: null,
    confidenceLevel: null,
    diagnostic: null,
    ...overrides
  };
}

describe("core collection reducer", () => {
  it("classifies conflict before every other overall status rule", () => {
    // Even if other sources are complete, a conflict makes it FAILED.
    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "conflict", hasUsableEvidence: false }),
      createOutcome({ sourceKey: "pyth", status: "accepted" }),
      createOutcome({ sourceKey: "jupiter", status: "accepted" }),
      createOutcome({ sourceKey: "orca", status: "accepted" })
    ];
    expect(reduceCoreCollectionStatus(outcomes)).toBe("FAILED");
  });

  it("classifies all complete contributions as COMPLETE", () => {
    // 4 fresh/non-degraded accepted or identical_replay
    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "accepted" }),
      createOutcome({ sourceKey: "pyth", status: "identical_replay" }),
      createOutcome({ sourceKey: "jupiter", status: "accepted" }),
      createOutcome({ sourceKey: "orca", status: "accepted" })
    ];
    expect(reduceCoreCollectionStatus(outcomes)).toBe("COMPLETE");
  });

  it("classifies any useful mixed run as PARTIAL", () => {
    // A run not fully complete, no conflict, but has at least one complete or partial (usable degraded) outcome.
    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "accepted" }),
      createOutcome({ sourceKey: "pyth", status: "timeout", hasUsableEvidence: false }),
      createOutcome({ sourceKey: "jupiter", status: "degraded", hasUsableEvidence: true }),
      createOutcome({ sourceKey: "orca", status: "failed", hasUsableEvidence: false })
    ];
    expect(reduceCoreCollectionStatus(outcomes)).toBe("PARTIAL");
  });

  it("classifies stale or operational zero contribution as UNAVAILABLE", () => {
    const staleFreshness: Freshness = {
      isStale: true,
      validUntilUnixMs: 1000,
      derivedAt: 2000,
      policyKind: "pool_state",
      reasons: ["expired_past_valid_for"]
    };

    // Stale status, operational absences (timeout, network, unavailable, no_route) or stale freshness
    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "stale", hasUsableEvidence: false }),
      createOutcome({ sourceKey: "pyth", status: "timeout", hasUsableEvidence: false }),
      createOutcome({
        sourceKey: "jupiter",
        status: "accepted",
        freshness: staleFreshness,
        hasUsableEvidence: false
      }),
      createOutcome({ sourceKey: "orca", status: "network", hasUsableEvidence: false })
    ];
    expect(reduceCoreCollectionStatus(outcomes)).toBe("UNAVAILABLE");
  });

  it("classifies malformed or unexpected zero contribution as FAILED", () => {
    // Zero contributions but contains malformed/failed or non-usable degraded
    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "malformed", hasUsableEvidence: false }),
      createOutcome({ sourceKey: "pyth", status: "timeout", hasUsableEvidence: false }),
      createOutcome({ sourceKey: "jupiter", status: "degraded", hasUsableEvidence: false }), // all-null degraded / non-usable
      createOutcome({ sourceKey: "orca", status: "failed", hasUsableEvidence: false })
    ];
    expect(reduceCoreCollectionStatus(outcomes)).toBe("FAILED");
  });

  it("orders warnings by fixed source order then warning code", () => {
    const warnings: SourceWarning[] = [
      { source: "jupiter", code: "JUP_ERR_B", message: "Jup error B" },
      { source: "clmm-v2", code: "CLMM_ERR", message: "CLMM error" },
      { source: "jupiter", code: "JUP_ERR_A", message: "Jup error A" },
      { source: "pyth", code: "PYTH_ERR", message: "Pyth error" },
      { source: "orca", code: "ORCA_ERR", message: "Orca error" }
    ];
    const ordered = orderCoreWarnings(warnings);
    expect(ordered).toEqual([
      { source: "clmm-v2", code: "CLMM_ERR", message: "CLMM error" },
      { source: "pyth", code: "PYTH_ERR", message: "Pyth error" },
      { source: "jupiter", code: "JUP_ERR_A", message: "Jup error A" },
      { source: "jupiter", code: "JUP_ERR_B", message: "Jup error B" },
      { source: "orca", code: "ORCA_ERR", message: "Orca error" }
    ]);
  });

  it("correctly counts status categorizations and aggregates counts", () => {
    const staleFreshness: Freshness = {
      isStale: true,
      validUntilUnixMs: 1000,
      derivedAt: 2000,
      policyKind: "pool_state",
      reasons: ["expired_past_valid_for"]
    };

    const outcomes: SourceCollectionOutcome[] = [
      createOutcome({ sourceKey: "clmm-v2", status: "accepted" }), // complete
      createOutcome({ sourceKey: "pyth", status: "degraded", hasUsableEvidence: true }), // partial
      createOutcome({ sourceKey: "jupiter", status: "accepted", freshness: staleFreshness }), // stale
      createOutcome({ sourceKey: "orca", status: "failed" }) // absentOrFailed
    ];

    const counts = countCoreCollectionOutcomes(outcomes);
    expect(counts).toEqual({
      complete: 1,
      partial: 1,
      stale: 1,
      absentOrFailed: 1
    });
  });
});
