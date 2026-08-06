# Issue #160 Clock Skew Investigation Record

## Scope and UTC Window

- **Investigation Timestamp (UTC):** `2026-08-06T14:30:44Z`
- **Host Name:** `gary-minipcpn51s1`
- **Target Repository:** `opsclawd/sol-usdc-clmm-intelligence`
- **Investigation Window:** Last 90 days (`since "90 days ago"`)

## Deployed Commit

- **Git Commit SHA:** `ddaded76cbc8ee8b48bec34d1992d11f0f6ab3bd`

## Database Aggregate Tables

Query attempted:

```bash
psql "$DATABASE_URL" -X --set ON_ERROR_STOP=1 --file scripts/diagnostics/clock-skew.sql
```

**Result:** Unverified / Missing.
`DATABASE_URL` environment variable was not configured in the execution environment (`psql: error: connection to server on socket "/run/postgresql/.s.PGSQL.5432" failed: FATAL: role "gary" does not exist`). PostgreSQL diagnostic script `scripts/diagnostics/clock-skew.sql` could not be executed against a production database instance.

| Metric                   | Result     |
| ------------------------ | ---------- |
| Total Raw Observations   | Unverified |
| Total Parse Failure Rows | Unverified |
| Skew Failed Rows         | Unverified |
| Non-Skew Failed Rows     | Unverified |

## Redacted Newest-Violation Rows

**Result:** Unverified / None available due to unexecuted database query.

| Received At (UTC) | Source | Predicate Violations | Future Delta (ms) | Fetch-Observed Delta (ms) | Receive-Fetch Delta (ms) |
| ----------------- | ------ | -------------------- | ----------------- | ------------------------- | ------------------------ |
| N/A               | N/A    | N/A                  | N/A               | N/A                       | N/A                      |

## Collector Log Result

Command executed:

```bash
journalctl --user -u hermes-gateway.service --since "90 days ago" --no-pager | rg "FreshnessValidationError|beyond clock skew tolerance"
```

**Result:** `-- No entries --`
The target systemd user service `hermes-gateway.service` returned zero log entries. The active collector service unit name and journal access for the target window are unconfirmed on this execution host.

## NTP Result

Commands executed:

```bash
timedatectl show --property=NTPSynchronized --property=NTP --property=TimeUSec --property=RTCTimeUSec --property=Timezone
timedatectl timesync-status
```

**Output:**

```text
Timezone=America/Edmonton
NTP=yes
NTPSynchronized=yes
TimeUSec=Thu 2026-08-06 08:30:34 MDT
RTCTimeUSec=Thu 2026-08-06 08:30:34 MDT

       Server: 23.159.16.194 (2.manjaro.pool.ntp.org)
Poll interval: 34min 8s (min: 32s; max 34min 8s)
         Leap: normal
      Version: 4
      Stratum: 2
    Reference: 10A428C5
    Precision: 1us (-25)
Root distance: 1.136ms (max: 5s)
       Offset: -1.865ms
        Delay: 58.268ms
       Jitter: 5.277ms
 Packet count: 5028
    Frequency: +6.514ppm
```

**Result:** Host clock NTP synchronization is healthy (`NTPSynchronized=yes`, measured offset `-1.865ms`).

## Source-to-Observation-Kind Blast Radius

If clock skew were present, the affected source-to-observation-kind mappings governed by taxonomy freshness tolerances in `src/domain/taxonomy/registry.ts` would be:

| Source           | Allowed Observation Kinds                                                      | Taxonomy Freshness Tolerance |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| `clmm-v2`        | `pool_state`, `position_state`, `fee_metrics`, `trigger_event`, `data_quality` | 5,000 ms                     |
| `pyth-hermes`    | `oracle_price`                                                                 | 5,000 ms                     |
| `jupiter-quote`  | `dex_price`                                                                    | 5,000 ms                     |
| `orca-whirlpool` | `dex_price`, `pool_depth`                                                      | 5,000 ms                     |

`src/domain/taxonomy/registry.ts` remains unchanged at `5_000` ms across all four decision dispositions produced by this investigation.

## Disposition

`BLOCKED (Environment Inaccessible)`

## Conclusion

The investigation is **BLOCKED** because required production environment access is not available in the current execution environment:

1. Production `DATABASE_URL` environment variable is not configured or accessible, preventing execution of `scripts/diagnostics/clock-skew.sql`.
2. Systemd service logs for `hermes-gateway.service` are unconfirmed / inaccessible on this execution host.

Per repository policy invariants and review criteria:

- The task is marked as **BLOCKED** pending operator provision of production environment access.
- `src/domain/taxonomy/registry.ts` remains unchanged at `5_000` ms.
- No repository policy, code, or tolerance values are modified without verified production data.

## Required Prerequisites to Unblock

To unblock and perform a conclusive run, the operator must provide:

1. A verified production `DATABASE_URL` environment variable and run `psql "$DATABASE_URL" -X --set ON_ERROR_STOP=1 --file scripts/diagnostics/clock-skew.sql` on the production database.
2. The exact production VPS hostname and confirmed systemd service unit name running the intelligence collector (and matching `journalctl` log output for the 90-day window).
3. Re-evaluation of the decision matrix using the completed 3-source evidence payload.
