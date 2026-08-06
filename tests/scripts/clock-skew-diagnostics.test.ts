import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("clock skew diagnostics SQL script", () => {
  it("keeps the production diagnostic read only", async () => {
    const sql = await readFile(
      new URL("../../scripts/diagnostics/clock-skew.sql", import.meta.url),
      "utf8"
    );

    expect(sql).toContain("BEGIN TRANSACTION READ ONLY");
    expect(sql).toContain("ROLLBACK");

    const strippedSql = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    const statements = strippedSql
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0);

    const mutationTokens = [
      "INSERT",
      "UPDATE",
      "DELETE",
      "MERGE",
      "ALTER",
      "DROP",
      "TRUNCATE",
      "CREATE",
      "GRANT",
      "REVOKE",
      "CALL",
      "COPY"
    ];

    for (const stmt of statements) {
      const cleanStmt = stmt.replace(/^\\.*$/gm, "").trim();
      if (!cleanStmt) continue;

      const firstToken = cleanStmt.split(/\s+/)[0]?.toUpperCase();
      expect(mutationTokens).not.toContain(firstToken);
      if (firstToken === "COPY") {
        expect(cleanStmt.toUpperCase()).not.toContain("FROM");
      }
    }
  });

  it("matches all three computeFreshness clock-skew predicates at five seconds", async () => {
    const sql = await readFile(
      new URL("../../scripts/diagnostics/clock-skew.sql", import.meta.url),
      "utf8"
    );

    expect(sql).toMatch(/\\set\s+tolerance_ms\s+5000/);

    const hasObservedFutureDelta =
      sql.includes("observed_at_unix_ms - received_at_unix_ms") ||
      sql.includes("observed_future_ms");
    const hasFetchBeforeObservedDelta =
      sql.includes("observed_at_unix_ms - fetched_at_unix_ms") ||
      sql.includes("fetch_before_observed_ms");
    const hasReceiveBeforeFetchDelta =
      sql.includes("fetched_at_unix_ms - received_at_unix_ms") ||
      sql.includes("receive_before_fetch_ms");

    expect(hasObservedFutureDelta).toBe(true);
    expect(hasFetchBeforeObservedDelta).toBe(true);
    expect(hasReceiveBeforeFetchDelta).toBe(true);

    const hasObservedFutureComp =
      sql.includes("observed_future_ms > :tolerance_ms") ||
      sql.includes("observed_at_unix_ms - received_at_unix_ms > :tolerance_ms");
    const hasFetchBeforeObservedComp =
      sql.includes("fetch_before_observed_ms > :tolerance_ms") ||
      sql.includes("observed_at_unix_ms - fetched_at_unix_ms > :tolerance_ms");
    const hasReceiveBeforeFetchComp =
      sql.includes("receive_before_fetch_ms > :tolerance_ms") ||
      sql.includes("fetched_at_unix_ms - received_at_unix_ms > :tolerance_ms");

    expect(hasObservedFutureComp).toBe(true);
    expect(hasFetchBeforeObservedComp).toBe(true);
    expect(hasReceiveBeforeFetchComp).toBe(true);
  });

  it("reports skew failures separately from unrelated parse failures", async () => {
    const sql = await readFile(
      new URL("../../scripts/diagnostics/clock-skew.sql", import.meta.url),
      "utf8"
    );

    expect(sql).toContain("skew_failed_rows");
    expect(sql).toContain("non_skew_failed_rows");
    expect(sql).toContain("is_any_skew IS NOT TRUE");
  });

  it("orders newest failed rows by received_at_unix_ms DESC", async () => {
    const sql = await readFile(
      new URL("../../scripts/diagnostics/clock-skew.sql", import.meta.url),
      "utf8"
    );

    expect(sql).toContain("ORDER BY received_at_unix_ms DESC");
  });
});

export interface ClockSkewEvidence {
  db: {
    skewFailedRows: number;
    providerCount: number;
  } | null;
  logs: {
    matchingErrorsPresent: boolean;
    confirmedWindowAndService: boolean;
    providersWithLogErrors: string[];
  } | null;
  hostClock: {
    ntpSynchronized: boolean;
    ntpHealthy: boolean;
  } | null;
}

export type ClockSkewDisposition =
  | "NO_SKEW"
  | "HOST_CLOCK_DRIFT"
  | "PROVIDER_TIMESTAMP_SEMANTICS"
  | "INCONCLUSIVE";

export function classifyClockSkewEvidence(evidence: ClockSkewEvidence): ClockSkewDisposition {
  if (!evidence.db || !evidence.logs || !evidence.hostClock) {
    return "INCONCLUSIVE";
  }

  if (!evidence.logs.confirmedWindowAndService) {
    return "INCONCLUSIVE";
  }

  const { db, logs, hostClock } = evidence;

  if (
    db.skewFailedRows === 0 &&
    !logs.matchingErrorsPresent &&
    hostClock.ntpSynchronized &&
    hostClock.ntpHealthy
  ) {
    return "NO_SKEW";
  }

  if (
    db.skewFailedRows > 0 &&
    db.providerCount >= 2 &&
    logs.matchingErrorsPresent &&
    logs.providersWithLogErrors.length >= 2 &&
    (!hostClock.ntpSynchronized || !hostClock.ntpHealthy)
  ) {
    return "HOST_CLOCK_DRIFT";
  }

  if (
    db.skewFailedRows > 0 &&
    db.providerCount === 1 &&
    logs.matchingErrorsPresent &&
    logs.providersWithLogErrors.length === 1 &&
    hostClock.ntpSynchronized &&
    hostClock.ntpHealthy
  ) {
    return "PROVIDER_TIMESTAMP_SEMANTICS";
  }

  return "INCONCLUSIVE";
}

describe("clock skew fail-closed decision table", () => {
  it("classifies healthy zero-violation evidence as NO_SKEW", () => {
    const evidence: ClockSkewEvidence = {
      db: { skewFailedRows: 0, providerCount: 0 },
      logs: {
        matchingErrorsPresent: false,
        confirmedWindowAndService: true,
        providersWithLogErrors: []
      },
      hostClock: { ntpSynchronized: true, ntpHealthy: true }
    };
    expect(classifyClockSkewEvidence(evidence)).toBe("NO_SKEW");
  });

  it("classifies cross-provider skew with unhealthy NTP as HOST_CLOCK_DRIFT", () => {
    const evidence: ClockSkewEvidence = {
      db: { skewFailedRows: 15, providerCount: 2 },
      logs: {
        matchingErrorsPresent: true,
        confirmedWindowAndService: true,
        providersWithLogErrors: ["pyth-hermes", "jupiter-quote"]
      },
      hostClock: { ntpSynchronized: false, ntpHealthy: false }
    };
    expect(classifyClockSkewEvidence(evidence)).toBe("HOST_CLOCK_DRIFT");
  });

  it("classifies isolated skew with healthy NTP as PROVIDER_TIMESTAMP_SEMANTICS", () => {
    const evidence: ClockSkewEvidence = {
      db: { skewFailedRows: 5, providerCount: 1 },
      logs: {
        matchingErrorsPresent: true,
        confirmedWindowAndService: true,
        providersWithLogErrors: ["pyth-hermes"]
      },
      hostClock: { ntpSynchronized: true, ntpHealthy: true }
    };
    expect(classifyClockSkewEvidence(evidence)).toBe("PROVIDER_TIMESTAMP_SEMANTICS");
  });

  it("classifies incomplete, unhandled, or conflicting evidence as INCONCLUSIVE", () => {
    expect(
      classifyClockSkewEvidence({
        db: null,
        logs: {
          matchingErrorsPresent: false,
          confirmedWindowAndService: true,
          providersWithLogErrors: []
        },
        hostClock: { ntpSynchronized: true, ntpHealthy: true }
      })
    ).toBe("INCONCLUSIVE");

    expect(
      classifyClockSkewEvidence({
        db: { skewFailedRows: 0, providerCount: 0 },
        logs: {
          matchingErrorsPresent: false,
          confirmedWindowAndService: true,
          providersWithLogErrors: []
        },
        hostClock: { ntpSynchronized: false, ntpHealthy: false }
      })
    ).toBe("INCONCLUSIVE");

    expect(
      classifyClockSkewEvidence({
        db: { skewFailedRows: 10, providerCount: 1 },
        logs: {
          matchingErrorsPresent: false,
          confirmedWindowAndService: true,
          providersWithLogErrors: []
        },
        hostClock: { ntpSynchronized: true, ntpHealthy: true }
      })
    ).toBe("INCONCLUSIVE");

    expect(
      classifyClockSkewEvidence({
        db: { skewFailedRows: 20, providerCount: 2 },
        logs: {
          matchingErrorsPresent: true,
          confirmedWindowAndService: true,
          providersWithLogErrors: ["pyth-hermes", "jupiter-quote"]
        },
        hostClock: { ntpSynchronized: true, ntpHealthy: true }
      })
    ).toBe("INCONCLUSIVE");
  });
});
