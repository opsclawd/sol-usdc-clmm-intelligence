import { describe, expect, it } from "vitest";
import {
  mapPriceSourceOutcome,
  mapClmmSourceOutcome,
  mapSourceError,
  redactDiagnostic
} from "../../src/application/source-outcome.js";
import { PostPersistenceOutputError } from "../../src/application/ingest-raw-observation.js";
import { ClmmObservationConflictError } from "../../src/application/collect-clmm-bundle.js";
import type { PriceSourceResult } from "../../src/application/price-source-result.js";
import type { CollectClmmBundleResult } from "../../src/application/collect-clmm-bundle.js";

import type { RawObservationRow } from "../../src/ports/observation-repo.js";

describe("source-outcome mapping", () => {
  describe("maps leaf status without inferring usability from status alone", () => {
    it("maps every price source result status correctly", () => {
      // 1. accepted
      const accepted: PriceSourceResult = {
        status: "accepted",
        rawObservationId: 1,
        normalizedCount: 2,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 1000,
          derivedAt: 500,
          policyKind: "oracle_price",
          reasons: []
        },
        confidenceLevel: "high"
      };
      const mappedAccepted = mapPriceSourceOutcome("pyth", "pyth-hermes", accepted);
      expect(mappedAccepted.status).toBe("accepted");
      expect(mappedAccepted.hasUsableEvidence).toBe(true);
      expect(mappedAccepted.rawObservationId).toBe(1);
      expect(mappedAccepted.normalizedCount).toBe(2);

      // 2. identical_replay
      const replay: PriceSourceResult = {
        status: "identical_replay",
        rawObservationId: 2,
        normalizedCount: 0,
        warnings: [],
        freshness: {
          isStale: false,
          validUntilUnixMs: 1000,
          derivedAt: 500,
          policyKind: "oracle_price",
          reasons: []
        },
        confidenceLevel: "high"
      };
      const mappedReplay = mapPriceSourceOutcome("pyth", "pyth-hermes", replay);
      expect(mappedReplay.status).toBe("identical_replay");
      expect(mappedReplay.hasUsableEvidence).toBe(true);

      // 3. stale
      const stale: PriceSourceResult = {
        status: "stale",
        rawObservationId: 3,
        normalizedCount: 1,
        warnings: [],
        freshness: {
          isStale: true,
          validUntilUnixMs: 1000,
          derivedAt: 500,
          policyKind: "oracle_price",
          reasons: []
        },
        confidenceLevel: "high"
      };
      const mappedStale = mapPriceSourceOutcome("pyth", "pyth-hermes", stale);
      expect(mappedStale.status).toBe("stale");
      // status label alone does not imply usability:
      // wait, the requirement is: "Preserve explicit `hasUsableEvidence`; never derive it solely from `status`."
      // In FailedResult or price outcomes, wait, hasUsableEvidence is in type FailedResult (and other price source results?)
      // Wait, let's check:
      // "extend the `failed` member of `PriceSourceResult` with optional durable evidence metadata, and export `redactDiagnostic`, `mapPriceSourceOutcome`, `mapClmmSourceOutcome`, and `mapSourceError`."
      // "Extend only the price `failed` variant without breaking existing producers:
      // export type FailedResult = Readonly<{
      //   status: "failed";
      //   summary: string;
      //   durableEvidence?: Readonly<{
      //     rawObservationId: number;
      //     normalizedCount: number;
      //   }>;
      //   hasUsableEvidence?: boolean;
      // }>;"
      // Wait, is hasUsableEvidence present on FailedResult only, or on all outcomes?
      // On `SourceCollectionOutcome`, it is `hasUsableEvidence: boolean`.
      // So the mapping function `mapPriceSourceOutcome` must return a `SourceCollectionOutcome` which requires `hasUsableEvidence: boolean`.
      // For price outcomes:
      // status "accepted", "identical_replay", "stale", "degraded" have hasUsableEvidence = true by default.
      // status "timeout", "network", "unavailable", "malformed", "no_route", "conflict" have hasUsableEvidence = false by default.
      // For status "failed", if `result` has `hasUsableEvidence` boolean, we preserve it exactly!
      // Let's check:
      const failedWithUsable: PriceSourceResult = {
        status: "failed",
        summary: "failed but with usable evidence",
        hasUsableEvidence: true,
        durableEvidence: { rawObservationId: 4, normalizedCount: 3 }
      };
      const mappedFailedUsable = mapPriceSourceOutcome("pyth", "pyth-hermes", failedWithUsable);
      expect(mappedFailedUsable.status).toBe("failed");
      expect(mappedFailedUsable.hasUsableEvidence).toBe(true);
      expect(mappedFailedUsable.rawObservationId).toBe(4);
      expect(mappedFailedUsable.normalizedCount).toBe(3);

      const failedWithoutUsable: PriceSourceResult = {
        status: "failed",
        summary: "failed without usable evidence",
        hasUsableEvidence: false
      };
      const mappedFailedNotUsable = mapPriceSourceOutcome(
        "pyth",
        "pyth-hermes",
        failedWithoutUsable
      );
      expect(mappedFailedNotUsable.status).toBe("failed");
      expect(mappedFailedNotUsable.hasUsableEvidence).toBe(false);
    });

    it("maps CLmm bundle results correctly", () => {
      const accepted: CollectClmmBundleResult = {
        rawObservationId: 10,
        rawOutcome: { outcome: "inserted", row: { id: 10 } as unknown as RawObservationRow },
        normalizedCount: 5,
        parseStatus: "parsed"
      };
      const mapped = mapClmmSourceOutcome(accepted);
      expect(mapped.sourceKey).toBe("clmm-v2");
      expect(mapped.source).toBe("clmm-v2-bundle");
      expect(mapped.status).toBe("accepted");
      expect(mapped.hasUsableEvidence).toBe(true);
      expect(mapped.rawObservationId).toBe(10);
      expect(mapped.normalizedCount).toBe(5);

      const replay: CollectClmmBundleResult = {
        rawObservationId: 10,
        rawOutcome: {
          outcome: "identical_replay",
          row: { id: 10 } as unknown as RawObservationRow
        },
        normalizedCount: 0,
        parseStatus: "parsed"
      };
      const mappedReplay = mapClmmSourceOutcome(replay);
      expect(mappedReplay.status).toBe("identical_replay");
      expect(mappedReplay.hasUsableEvidence).toBe(true);
    });
  });

  describe("redacts secrets before diagnostics cross the aggregate boundary", () => {
    it("redacts secret patterns in diagnostics", () => {
      const dirty =
        "Error: api_key=super-secret-123, bearer token=abc-xyz, auth token=foo, oauth_secret=bar";
      const clean = redactDiagnostic(dirty);
      expect(clean).not.toContain("super-secret-123");
      expect(clean).not.toContain("abc-xyz");
      expect(clean).not.toContain("foo");
      expect(clean).not.toContain("bar");
      expect(clean.toLowerCase()).toContain("[redacted]");
    });

    it("redacts secrets with non-alphanumeric characters like dots, pluses, or slashes", () => {
      const dirty =
        "Error: api_key=eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMe/KKF2QT4fwpMe+g, token=abc.def+ghi/jkl";
      const clean = redactDiagnostic(dirty);
      expect(clean).not.toContain("eyJhbGciOi");
      expect(clean).not.toContain("SflKxwRJSMe");
      expect(clean).not.toContain("abc.def");
      expect(clean.toLowerCase()).toContain("[redacted]");
    });

    it("maps errors with redacted diagnostics", () => {
      const unexpectedErr = new Error("failed: secret api_key=123");
      const mapped = mapSourceError("pyth", "pyth-hermes", unexpectedErr);
      expect(mapped.status).toBe("failed");
      expect(mapped.hasUsableEvidence).toBe(false);
      expect(mapped.diagnostic).toBeDefined();
      expect(mapped.diagnostic).not.toContain("123");
      expect(mapped.diagnostic?.toLowerCase()).toContain("[redacted]");
    });

    it("maps ClmmObservationConflictError with truncated and redacted hashes", () => {
      const conflict = new ClmmObservationConflictError(
        "clmm-v2-bundle",
        "some-key",
        "abcdef1234567890abcdef1234567890abcdef12",
        "fedcba0987654321fedcba0987654321fedcba09"
      );
      const mapped = mapSourceError("clmm-v2", "clmm-v2-bundle", conflict);
      expect(mapped.status).toBe("conflict");
      expect(mapped.hasUsableEvidence).toBe(false);
      // both hashes should be redacted/truncated (sliced to 8 chars) in diagnostic
      expect(mapped.diagnostic).toBeDefined();
      expect(mapped.diagnostic).toContain("abcdef12");
      expect(mapped.diagnostic).toContain("fedcba09");
      expect(mapped.diagnostic).not.toContain("abcdef1234567890abcdef1234567890abcdef12");
      expect(mapped.diagnostic).not.toContain("fedcba0987654321fedcba0987654321fedcba09");
    });

    it("maps PostPersistenceOutputError as failed-but-durable", () => {
      const ppe = new PostPersistenceOutputError(
        "Failed to write compatibility file: disk full, auth=123",
        {
          rawObservationId: 100,
          rawOutcome: "inserted",
          normalizedCount: 5,
          parseStatus: "parsed"
        },
        { cause: new Error("write failure") }
      );
      const mapped = mapSourceError("pyth", "pyth-hermes", ppe);
      expect(mapped.status).toBe("failed");
      expect(mapped.hasUsableEvidence).toBe(true);
      expect(mapped.rawObservationId).toBe(100);
      expect(mapped.normalizedCount).toBe(5);
      expect(mapped.diagnostic).toContain("Failed to write compatibility file");
      expect(mapped.diagnostic).not.toContain("123");
      expect(mapped.diagnostic?.toLowerCase()).toContain("[redacted]");
    });
  });
});
