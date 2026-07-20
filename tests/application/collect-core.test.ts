import { describe, expect, it } from "vitest";
import {
  collectCore,
  type CollectCoreDeps,
  type CoreLeaf
} from "../../src/application/collect-core.js";
import type {
  CollectionRunContext,
  SourceCollectionOutcome,
  CoreSourceKey
} from "../../src/contracts/collection-run.js";
import type { Source } from "../../src/contracts/taxonomy.js";

const VALID_CONTEXT: CollectionRunContext = {
  runId: "run-123",
  startedAtUnixMs: 1715342400000 // 2026-05-10T12:00:00.000Z
};

function mockOutcome(
  sourceKey: CoreSourceKey,
  source: Source,
  overrides?: Partial<SourceCollectionOutcome>
): SourceCollectionOutcome {
  return {
    sourceKey,
    source,
    status: "accepted",
    hasUsableEvidence: true,
    rawObservationId: 100,
    normalizedCount: 1,
    warnings: [],
    freshness: {
      isStale: false,
      validUntilUnixMs: Date.now() + 60000,
      derivedAt: Date.now(),
      policyKind: "pool_state",
      reasons: []
    },
    confidenceLevel: "high",
    diagnostic: null,
    ...overrides
  };
}

describe("collectCore", () => {
  it("starts all four leaves before awaiting and invokes each exactly once", async () => {
    let activeInvocations = 0;
    const startOrder: string[] = [];

    const createLeaf = (name: string, outcome: SourceCollectionOutcome): CoreLeaf => {
      return async () => {
        activeInvocations++;
        startOrder.push(name);
        // Wait a tiny bit to allow concurrency check
        await new Promise((r) => setTimeout(r, 10));
        return outcome;
      };
    };

    const deps: CollectCoreDeps = {
      clmmV2: createLeaf("clmmV2", mockOutcome("clmm-v2", "clmm-v2-bundle")),
      pyth: createLeaf("pyth", mockOutcome("pyth", "pyth-hermes")),
      jupiter: createLeaf("jupiter", mockOutcome("jupiter", "jupiter-quote")),
      orca: createLeaf("orca", mockOutcome("orca", "orca-public-api"))
    };

    const resultPromise = collectCore(deps, VALID_CONTEXT);
    // While the promise is running, all four should have been called
    expect(startOrder.length).toBe(4);
    const result = await resultPromise;
    expect(result.status).toBe("COMPLETE");
    expect(activeInvocations).toBe(4);
  });

  it("passes the same collection context object to all four leaves", async () => {
    const receivedContexts: CollectionRunContext[] = [];
    const createLeaf = (sourceKey: CoreSourceKey, source: Source): CoreLeaf => {
      return async (ctx) => {
        receivedContexts.push(ctx);
        return mockOutcome(sourceKey, source);
      };
    };

    const deps: CollectCoreDeps = {
      clmmV2: createLeaf("clmm-v2", "clmm-v2-bundle"),
      pyth: createLeaf("pyth", "pyth-hermes"),
      jupiter: createLeaf("jupiter", "jupiter-quote"),
      orca: createLeaf("orca", "orca-public-api")
    };

    await collectCore(deps, VALID_CONTEXT);
    expect(receivedContexts.length).toBe(4);
    receivedContexts.forEach((ctx) => {
      expect(ctx).toBe(VALID_CONTEXT);
    });
  });

  it("preserves successful outcomes when sibling leaves reject", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () => mockOutcome("clmm-v2", "clmm-v2-bundle"),
      pyth: async () => mockOutcome("pyth", "pyth-hermes"),
      jupiter: async () => {
        throw new Error("Jupiter query failed");
      },
      orca: async () => mockOutcome("orca", "orca-public-api")
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.clmmV2.status).toBe("accepted");
    expect(result.pyth.status).toBe("accepted");
    expect(result.jupiter.status).toBe("failed");
    expect(result.jupiter.diagnostic).toContain("Jupiter query failed");
    expect(result.orca.status).toBe("accepted");
    expect(result.status).toBe("PARTIAL");
  });

  it("returns COMPLETE for four accepted or replayed fresh contributions", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () => mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "accepted" }),
      pyth: async () => mockOutcome("pyth", "pyth-hermes", { status: "identical_replay" }),
      jupiter: async () => mockOutcome("jupiter", "jupiter-quote", { status: "accepted" }),
      orca: async () => mockOutcome("orca", "orca-public-api", { status: "accepted" })
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.status).toBe("COMPLETE");
    expect(result.shouldFailCommand).toBe(false);
  });

  it("returns PARTIAL for every single-source timeout malformed failure stale or usable degradation", async () => {
    const failStatuses: SourceCollectionOutcome["status"][] = [
      "timeout",
      "malformed",
      "failed",
      "stale",
      "degraded"
    ];

    for (const status of failStatuses) {
      const deps: CollectCoreDeps = {
        clmmV2: async () => mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "accepted" }),
        pyth: async () => mockOutcome("pyth", "pyth-hermes", { status: "accepted" }),
        jupiter: async () => mockOutcome("jupiter", "jupiter-quote", { status: "accepted" }),
        orca: async () => {
          if (status === "stale") {
            return mockOutcome("orca", "orca-public-api", {
              status: "stale",
              freshness: {
                isStale: true,
                validUntilUnixMs: 0,
                derivedAt: 0,
                policyKind: "pool_state",
                reasons: []
              }
            });
          }
          if (status === "degraded") {
            return mockOutcome("orca", "orca-public-api", {
              status: "degraded",
              hasUsableEvidence: true
            });
          }
          return mockOutcome("orca", "orca-public-api", { status, hasUsableEvidence: false });
        }
      };

      const result = await collectCore(deps, VALID_CONTEXT);
      expect(result.status).toBe("PARTIAL");
      expect(result.shouldFailCommand).toBe(false);
    }
  });

  it("returns PARTIAL for multiple failures when one useful source remains", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () => mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "accepted" }),
      pyth: async () =>
        mockOutcome("pyth", "pyth-hermes", { status: "timeout", hasUsableEvidence: false }),
      jupiter: async () =>
        mockOutcome("jupiter", "jupiter-quote", { status: "failed", hasUsableEvidence: false }),
      orca: async () =>
        mockOutcome("orca", "orca-public-api", { status: "unavailable", hasUsableEvidence: false })
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.status).toBe("PARTIAL");
    expect(result.shouldFailCommand).toBe(false);
  });

  it("returns UNAVAILABLE for total operational or stale absence", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () =>
        mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "timeout", hasUsableEvidence: false }),
      pyth: async () =>
        mockOutcome("pyth", "pyth-hermes", {
          status: "stale",
          freshness: {
            isStale: true,
            validUntilUnixMs: 0,
            derivedAt: 0,
            policyKind: "pool_state",
            reasons: []
          }
        }),
      jupiter: async () =>
        mockOutcome("jupiter", "jupiter-quote", { status: "network", hasUsableEvidence: false }),
      orca: async () =>
        mockOutcome("orca", "orca-public-api", { status: "unavailable", hasUsableEvidence: false })
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.shouldFailCommand).toBe(true);
  });

  it("returns FAILED for total malformed or unexpected failure", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () =>
        mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "malformed", hasUsableEvidence: false }),
      pyth: async () =>
        mockOutcome("pyth", "pyth-hermes", { status: "failed", hasUsableEvidence: false }),
      jupiter: async () =>
        mockOutcome("jupiter", "jupiter-quote", { status: "malformed", hasUsableEvidence: false }),
      orca: async () =>
        mockOutcome("orca", "orca-public-api", { status: "failed", hasUsableEvidence: false })
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.status).toBe("FAILED");
    expect(result.shouldFailCommand).toBe(true);
  });

  it("returns FAILED for any conflict despite successful siblings", async () => {
    const deps: CollectCoreDeps = {
      clmmV2: async () => mockOutcome("clmm-v2", "clmm-v2-bundle", { status: "accepted" }),
      pyth: async () => mockOutcome("pyth", "pyth-hermes", { status: "accepted" }),
      jupiter: async () =>
        mockOutcome("jupiter", "jupiter-quote", { status: "conflict", hasUsableEvidence: false }),
      orca: async () => mockOutcome("orca", "orca-public-api", { status: "accepted" })
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.status).toBe("FAILED");
    expect(result.shouldFailCommand).toBe(true);
  });

  it("orders named outcomes and warnings independently of promise completion timing", async () => {
    // We want to verify that regardless of the completion order (by delaying some promises),
    // the returned object assigns the correct outcomes to each name, and warnings are sorted consistently.
    const createDelayedLeaf = (
      sourceKey: CoreSourceKey,
      source: Source,
      delayMs: number,
      warningsList: { code: string; message: string | null }[]
    ): CoreLeaf => {
      return async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        return mockOutcome(sourceKey, source, {
          warnings: warningsList.map((w) => ({ source: sourceKey, ...w }))
        });
      };
    };

    const deps: CollectCoreDeps = {
      clmmV2: createDelayedLeaf("clmm-v2", "clmm-v2-bundle", 40, [
        { code: "W_CLMM", message: "clmm warn" }
      ]),
      pyth: createDelayedLeaf("pyth", "pyth-hermes", 10, [
        { code: "W_PYTH", message: "pyth warn" }
      ]),
      jupiter: createDelayedLeaf("jupiter", "jupiter-quote", 30, [
        { code: "W_JUP", message: "jup warn" }
      ]),
      orca: createDelayedLeaf("orca", "orca-public-api", 20, [
        { code: "W_ORCA", message: "orca warn" }
      ])
    };

    const result = await collectCore(deps, VALID_CONTEXT);
    expect(result.clmmV2.sourceKey).toBe("clmm-v2");
    expect(result.pyth.sourceKey).toBe("pyth");
    expect(result.jupiter.sourceKey).toBe("jupiter");
    expect(result.orca.sourceKey).toBe("orca");

    // Warnings rank order: clmm-v2 (0), pyth (1), jupiter (2), orca (3)
    expect(result.warnings.length).toBe(4);
    expect(result.warnings[0]!.code).toBe("W_CLMM");
    expect(result.warnings[1]!.code).toBe("W_PYTH");
    expect(result.warnings[2]!.code).toBe("W_JUP");
    expect(result.warnings[3]!.code).toBe("W_ORCA");
  });
});
