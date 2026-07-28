# Task Context: Task 2

Title: Request the current Orca pools endpoint

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-47
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-47
Start Commit: 519075961cf25d1b70b677a37ec123ad7f5ba213

## Task Requirements

**Files:**

- Modify: `src/application/collect-orca-pool-statistics.ts`
- Modify: `tests/application/collect-orca-pool-statistics.test.ts`
- Modify: `resources/sources.yaml`
- Reference only: `src/ports/http.ts`
- Reference only: `tests/fakes/fake-http.ts`

- [ ] **Step 1: Update the collector tests to require the exact current URL**

Define one URL constant near `ORCA_API_BASE` in `tests/application/collect-orca-pool-statistics.test.ts` and use it for every fake response:

```ts
const ORCA_POOL_URL =
  `${ORCA_API_BASE}/pools?addresses=${encodeURIComponent(DEFAULT_WHIRLPOOL_ADDRESS)}` +
  "&stats=24h";
```

Rename the first accepted test to `requests the address-filtered pools endpoint with 24h statistics` and add both the HTTP call assertion and the updated path metadata assertion:

```ts
expect(deps.http.calls).toEqual([
  {
    url: ORCA_POOL_URL,
    options: {
      timeoutMs: 5000,
      maxAttempts: 2
    }
  }
]);

expect(rawRow!.sourceRequestMeta).toMatchObject({ path: "/pools" });
```

Rename the malformed test to `rejects an Orca response without the configured pool before raw insertion`, and rename the partial-statistics test to `returns degraded usable evidence when 24h statistics are absent`. Keep their existing persistence and null-metric assertions.

- [ ] **Step 2: Run the request test and confirm it fails against `/public/pool`**

Run:

```bash
pnpm exec vitest run tests/application/collect-orca-pool-statistics.test.ts -t "requests the address-filtered pools endpoint with 24h statistics"
```

Expected: FAIL because the use case still requests `/public/pool?address=...`.

- [ ] **Step 3: Build the address-filtered URL and update redacted metadata**

In `src/application/collect-orca-pool-statistics.ts`, replace the path and URL construction with:

```ts
const path = "/pools";
const url = `${normalizedBase}${path}?addresses=${encodeURIComponent(poolAddress)}` + "&stats=24h";
```

Keep timeout, attempt count, error classification, validation-before-ingest, hashing, normalization, replay, conflict, and persistence code unchanged. The existing `redactedMeta` object must continue to include `statsWindow: "24h"` and must now persist `path: "/pools"`.

- [ ] **Step 4: Align the checked-in source catalog**

In the `orca-public-api` section of `resources/sources.yaml`, set:

```yaml
endpoint: /pools?addresses=:poolAddress&stats=24h
```

Keep the existing 24-hour-window limitation because the request explicitly opts into those statistics.

- [ ] **Step 5: Run request, degradation, replay, and formatting checks**

Run:

```bash
pnpm exec vitest run tests/application/collect-orca-pool-statistics.test.ts
pnpm exec eslint src/application/collect-orca-pool-statistics.ts tests/application/collect-orca-pool-statistics.test.ts
pnpm exec prettier --check src/application/collect-orca-pool-statistics.ts tests/application/collect-orca-pool-statistics.test.ts resources/sources.yaml
sed -n '58,70p' resources/sources.yaml | grep -F 'endpoint: /pools?addresses=:poolAddress&stats=24h'
```

Expected: all collector cases pass, the request assertion proves the exact URL and retry options, and the scoped source-catalog section contains the new endpoint.

- [ ] **Step 6: Commit the endpoint change**

```bash
git add src/application/collect-orca-pool-statistics.ts tests/application/collect-orca-pool-statistics.test.ts resources/sources.yaml
git commit -m "fix: query current Orca pools endpoint"
```

## Repository Targets

### Expected Files

- src/application/collect-orca-pool-statistics.ts
- tests/application/collect-orca-pool-statistics.test.ts
- resources/sources.yaml

### Reference Files

- src/ports/http.ts
- tests/fakes/fake-http.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/collect-orca-pool-statistics.test.ts
["pnpm","exec","eslint","src/application/collect-orca-pool-statistics.ts","tests/application/collect-orca-pool-statistics.test.ts"]
["pnpm","exec","prettier","--check","src/application/collect-orca-pool-statistics.ts","tests/application/collect-orca-pool-statistics.test.ts","resources/sources.yaml"]
sed -n '58,70p' resources/sources.yaml | grep -F 'endpoint: /pools?addresses=:poolAddress&stats=24h'
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact request construction**: Given a configured pool address, issue one GET to /pools with the encoded plural addresses parameter and stats=24h while retaining timeoutMs 5000 and maxAttempts 2. (Test: `requests the address-filtered pools endpoint with 24h statistics`)
- **pre-persistence configured-pool validation**: When the response lacks the configured address, return malformed with no raw or normalized insertion. (Test: `rejects an Orca response without the configured pool before raw insertion`)
- **no fabricated 24-hour statistics**: When the selected pool has TVL but no 24-hour stats, persist null volume and fees and return usable degraded evidence. (Test: `returns degraded usable evidence when 24h statistics are absent`)
- **stable replay classification**: When address, update time, slot, and content repeat, return identical_replay; when content changes at the same identity, return conflict. (Test: `recovers parsed Orca replay metadata from its linked normalized row`)
