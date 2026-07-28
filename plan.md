<!-- plan-review-required -->

# Orca Collector Current Pools Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore SOL/USDC Orca collection by querying the current address-filtered pools endpoint with 24-hour statistics, selecting the configured pool from the response array, and making the canonical active Whirlpool address the documented and tested default.

**Architecture:** Keep HTTP request construction and persistence orchestration in the existing application use case, while extending the pure Orca domain parser to validate and select from the API's `{ data: OrcaPoolData[] }` wrapper. Preserve the current normalization, replay, persistence, degradation, and source-outcome behavior; only the request target, wrapper parsing, and default pool identity change.

**Tech Stack:** TypeScript, Node.js, Vitest, pnpm, ESLint, Prettier, YAML configuration.

---

### Goal

`collectOrcaPoolStatistics` must request `GET /pools?addresses=<configured-address>&stats=24h`, parse the array wrapper by exact address, persist and normalize the selected canonical SOL/USDC pool as it does today, and explicitly report malformed/degraded outcomes instead of inventing absent metrics.

### Non-goals

- Do not change Raydium, Meteora, Jupiter, Pyth, Solana RPC, or clmm-v2 collectors.
- Do not add pagination, discovery, search, or automatic pool migration logic.
- Do not add metrics or change `PoolStatisticsPayloadV1`, normalization calculations, freshness policy, confidence policy, retry policy, repository ports, database schemas, or evidence-bundle contracts.
- Do not convert missing 24-hour volume or fee values into zero or estimates.
- Do not rewrite an operator's existing local `.env`; only update checked-in examples and documentation.
- Do not implement a single-pool path lookup or retain the ignored singular `address` query parameter.

### Affected files

- `src/domain/pool-statistics/orca.ts` — define and validate the array response wrapper and select the configured pool.
- `src/application/collect-orca-pool-statistics.ts` — construct the current endpoint URL and record the current path in request metadata.
- `tests/fixtures/orca-pool.ts` — model realistic array responses and use the canonical pool address.
- `tests/domain/pool-statistics/orca.test.ts` — cover address selection and malformed wrappers.
- `tests/application/collect-orca-pool-statistics.test.ts` — cover the request URL, selected response shape, persistence boundary, and explicit degradation.
- `resources/sources.yaml` — describe the actual Orca endpoint and query parameters.
- `.env.example` — set both Orca pool variables to the canonical address.
- `README.md` — update example pool identities and environment configuration.
- `docs/operator-runbook.md` — update operator configuration and sample output.
- `tests/scripts/derive-mvp-features.test.ts` — replace stale pool identity in script fixtures, split by test section because the file exceeds 500 lines and 10 test cases.
- `tests/scripts/assemble-evidence-bundle.test.ts` — replace stale pool identity in bundle fixtures, split by describe block because the file exceeds 500 lines.

### Behavioral invariants

The implementer must write the named tests before changing production behavior:

1. **Configured-address selection:** Given a valid array containing unrelated pools and the configured pool, the parser selects the configured pool regardless of array position. Test: `selects the configured pool from a multi-pool response before validating it`.
2. **Missing-address rejection:** Given an empty array or an array without the configured address, the parser throws `OrcaPoolValidationError` with field `address`; it never falls back to the first entry. Test: `rejects an array that does not contain the configured pool address`.
3. **Wrapper-shape rejection:** Given `data` that is null, an object, or another non-array value, the parser throws `OrcaPoolValidationError` with field `data`. Test: `rejects a response whose data member is not an array`.
4. **Exact request construction:** Given the configured address, collection performs one GET to `/pools?addresses=<encoded-address>&stats=24h`, retaining the existing 5-second timeout and two-attempt policy. Test: `requests the address-filtered pools endpoint with 24h statistics`.
5. **Pre-persistence validation:** Given a response array without the configured pool, collection returns `malformed`, `hasUsableEvidence: false`, `rawObservationId: null`, and `normalizedCount: 0`. Test: `rejects an Orca response without the configured pool before raw insertion`.
6. **No fabricated statistics:** Given the selected pool with TVL but no 24-hour stats block, collection persists TVL, leaves volume and fees null, and reports usable `degraded` evidence. The stats block field names (`volume24hUsdc`/`fees24hUsdc` per the design contract, or the `stats["24h"].volume/.fees` shape in the current fixture) are verified against live endpoint evidence before the fixture is committed; if they differ, the plan is revised with captured evidence rather than proceeding with a mismatched shape. Test: `returns degraded usable evidence when 24h statistics are absent`.
7. **Replay behavior remains stable:** Given the same selected pool address, `updatedAt`, and `updatedSlot`, identical raw content remains an identical replay; different content at that identity remains a conflict. Replay identity is derived from the **selected pool's address, updatedAt, updatedSlot, and content fields** (tvlUsdc, volume, fees when present) — not the whole wrapper. Unrelated array entries or array order changes do not affect replay classification when the selected pool's fields remain identical. Existing replay tests must continue to pass.

## Task 1: Parse and fixture Orca array responses

**Files:**

- Modify: `src/domain/pool-statistics/orca.ts`
- Modify: `tests/fixtures/orca-pool.ts`
- Modify: `tests/domain/pool-statistics/orca.test.ts`
- Modify: `tests/application/collect-orca-pool-statistics.test.ts`
- Reference only: `src/domain/pool-statistics/index.ts`
- Reference only: `tests/domain/pool-statistics/enrich.test.ts`

- [ ] **Step 1: Write failing domain tests for array selection and rejection**

Add these exact cases to the first parser describe block in `tests/domain/pool-statistics/orca.test.ts` before changing the fixture or parser:

```ts
it("selects the configured pool from a multi-pool response before validating it", () => {
  const configured = {
    address: DEFAULT_WHIRLPOOL_ADDRESS,
    tokenA: { address: DEFAULT_SOL_MINT },
    tokenB: { address: DEFAULT_USDC_MINT },
    updatedAt: "2026-07-19T06:00:00.000Z",
    updatedSlot: 1234567,
    tvlUsdc: "5000000.75",
    stats: {
      "24h": {
        volume: "1250000.50",
        fees: "3750.25"
      }
    }
  };
  const response = {
    data: [{ ...configured, address: "unrelatedPool" }, configured]
  };

  const { accepted } = acceptOrcaPoolResponse(
    response,
    DEFAULT_WHIRLPOOL_ADDRESS,
    DEFAULT_SOL_MINT,
    DEFAULT_USDC_MINT
  );

  expect(accepted.address).toBe(DEFAULT_WHIRLPOOL_ADDRESS);
});

it("rejects an array that does not contain the configured pool address", () => {
  expect(() =>
    acceptOrcaPoolResponse(
      { data: [] },
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    )
  ).toThrow(expect.objectContaining({ field: "address" }));
});

it("rejects a response whose data member is not an array", () => {
  expect(() =>
    acceptOrcaPoolResponse(
      { data: { address: DEFAULT_WHIRLPOOL_ADDRESS } },
      DEFAULT_WHIRLPOOL_ADDRESS,
      DEFAULT_SOL_MINT,
      DEFAULT_USDC_MINT
    )
  ).toThrow(expect.objectContaining({ field: "data" }));
});
```

- [ ] **Step 2: Run the new cases and confirm the old object parser fails them**

Run:

```bash
pnpm exec vitest run tests/domain/pool-statistics/orca.test.ts -t "selects the configured pool|rejects an array|data member is not an array"
```

Expected: FAIL because the fixture and parser still treat `data` as one object.

- [ ] **Step 3: Change the shared fixture to emit the live wrapper shape and canonical address**

In `tests/fixtures/orca-pool.ts`, change the response declaration and factory return while keeping `makeOrcaPoolResponse(overrides)` as the shared factory:

```ts
export interface OrcaPoolResponse {
  data: OrcaPoolData[];
}

export const DEFAULT_WHIRLPOOL_ADDRESS = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";

export function makeOrcaPoolResponse(overrides: Partial<OrcaPoolData> = {}): OrcaPoolResponse {
  const statsOverride =
    overrides.stats === undefined
      ? {
          "24h": {
            volume: "1250000.50",
            fees: "3750.25"
          }
        }
      : overrides.stats;

  const data: OrcaPoolData = {
    address: DEFAULT_WHIRLPOOL_ADDRESS,
    tokenA: {
      address: DEFAULT_SOL_MINT
    },
    tokenB: {
      address: DEFAULT_USDC_MINT
    },
    updatedAt: "2026-07-19T06:00:00.000Z",
    updatedSlot: 1234567,
    tvlUsdc: "5000000.75",
    hasWarning: false,
    ...overrides
  };

  if (statsOverride !== undefined) {
    data.stats = statsOverride;
  }

  return { data: [data] };
}
```

Update every direct access in `tests/application/collect-orca-pool-statistics.test.ts` from `response.data.updatedAt` or `response.data.updatedSlot` to the non-null selected fixture entry:

```ts
const pool = response.data[0]!;
```

Use `pool.updatedAt` and `pool.updatedSlot` when deriving replay identity or timestamps. Change the malformed response fixture from a bare object to an array containing the wrong-address object so the test exercises address lookup rather than obsolete wrapper validation:

```ts
deps.http.setResponse(url, { body: { data: [{ address: "wrong" }] } });
```

- [ ] **Step 4: Select the configured address from a validated array before existing field validation**

In `src/domain/pool-statistics/orca.ts`, make the exported wrapper shape:

```ts
export interface OrcaPoolResponse {
  data: OrcaPoolData[];
}
```

Replace the current object-only preamble in `acceptOrcaPoolResponse` with runtime-safe array validation and exact selection:

```ts
if (!response || typeof response !== "object" || !("data" in response)) {
  throw new OrcaPoolValidationError(
    "response",
    "Response must be an object containing a data array"
  );
}

const wrapper = response as OrcaPoolResponse;
if (!Array.isArray(wrapper.data)) {
  throw new OrcaPoolValidationError("data", "Response.data must be an array");
}

const data = (wrapper.data as unknown[]).find(
  (candidate): candidate is OrcaPoolData =>
    candidate !== null &&
    typeof candidate === "object" &&
    "address" in candidate &&
    candidate.address === configuredPoolAddress
);

if (!data) {
  throw new OrcaPoolValidationError(
    "address",
    `Configured pool address not found: ${configuredPoolAddress}`
  );
}
```

Remove the old top-level address mismatch branch. Leave token, timestamp, slot, TVL, volume, and fee validation unchanged and return `{ wrapper, accepted: data }`.

- [ ] **Step 5: Run the scoped parser and consumer checks**

Run:

```bash
pnpm exec vitest run tests/domain/pool-statistics/orca.test.ts tests/domain/pool-statistics/enrich.test.ts tests/application/collect-orca-pool-statistics.test.ts
pnpm exec eslint src/domain/pool-statistics/orca.ts tests/fixtures/orca-pool.ts tests/domain/pool-statistics/orca.test.ts tests/application/collect-orca-pool-statistics.test.ts
pnpm exec prettier --check src/domain/pool-statistics/orca.ts tests/fixtures/orca-pool.ts tests/domain/pool-statistics/orca.test.ts tests/application/collect-orca-pool-statistics.test.ts
pnpm exec tsc --noEmit
```

Expected: all selected suites pass; lint and formatting report no errors; TypeScript compiles without errors. This also proves the read-only enrichment consumer accepts the widened wrapper without modification.

- [ ] **Step 6: Commit the independently compiling parser change**

```bash
git add src/domain/pool-statistics/orca.ts tests/fixtures/orca-pool.ts tests/domain/pool-statistics/orca.test.ts tests/application/collect-orca-pool-statistics.test.ts
git commit -m "fix: parse Orca pool list responses"
```

## Task 2: Request the current Orca pools endpoint

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

## Task 3: Document the canonical Orca pool default

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/operator-runbook.md`
- Reference only: `tests/fixtures/orca-pool.ts`

- [ ] **Step 1: Replace operator-facing stale pool identities**

Replace every operator-facing occurrence of:

```text
HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw
```

with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

in `.env.example`, `README.md`, and `docs/operator-runbook.md`. This includes both `ORCA_SOL_USDC_WHIRLPOOL` and `WHIRLPOOL_ADDRESS`, as well as pool IDs in example payloads. Add this exact sentence next to the operator-runbook variable description:

```text
Existing deployments must update their local pool variables; changes to `.env.example` do not rewrite an existing `.env`.
```

- [ ] **Step 2: Verify only the changed configuration and documentation sections**

Run:

```bash
sed -n '48,68p' .env.example | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '48,68p' .env.example | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '325,340p' README.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '555,570p' README.md | grep -F 'ORCA_SOL_USDC_WHIRLPOOL=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '55,66p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '318,330p' docs/operator-runbook.md | grep -F 'WHIRLPOOL_ADDRESS=Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
sed -n '416,428p' docs/operator-runbook.md | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
git diff --check -- .env.example README.md docs/operator-runbook.md
```

Expected: every scoped example reports the canonical address and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Commit the operator-default update**

```bash
git add .env.example README.md docs/operator-runbook.md
git commit -m "docs: set canonical Orca SOL USDC pool"
```

## Task 4: Update derive-script primary cases to the canonical pool

**Files:**

- Modify: `tests/scripts/derive-mvp-features.test.ts` (only the `derive-mvp-features script` cases before the nested `script validation` block, approximately lines 252-373)

- [ ] **Step 1: Replace stale `WHIRLPOOL_ADDRESS` values in the scoped cases**

Within the two top-level cases named `script prints deterministic status counts and sorted warnings after persistence` and `script fails for missing scope malformed position list or infrastructure failure`, replace each configured pool value with:

```ts
WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
```

Do not change the missing-variable fixture or any assertions; this task updates fixture identity only.

- [ ] **Step 2: Run only the changed test cases and section checks**

Run:

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script prints deterministic status counts|script fails for missing scope"
sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '252,373p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/derive-mvp-features.test.ts
pnpm exec prettier --check tests/scripts/derive-mvp-features.test.ts
```

Expected: the two selected cases pass, the scoped section contains the canonical address and no stale address, and file lint/format checks pass.

- [ ] **Step 3: Commit the first independently tested derive-script section**

```bash
git add tests/scripts/derive-mvp-features.test.ts
git commit -m "test: update derive script pool fixtures"
```

## Task 5: Update derive-script validation cases to the canonical pool

**Files:**

- Modify: `tests/scripts/derive-mvp-features.test.ts` (only the nested `script validation` block, approximately lines 374-551)

- [ ] **Step 1: Replace stale pool values in the validation block**

Within `describe("script validation")`, replace every present `WHIRLPOOL_ADDRESS` value with:

```ts
WHIRLPOOL_ADDRESS: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
```

Keep the `should throw for missing WHIRLPOOL_ADDRESS` case without that variable so it continues to prove required configuration.

- [ ] **Step 2: Run the validation block and scoped identity checks**

Run:

```bash
pnpm exec vitest run tests/scripts/derive-mvp-features.test.ts -t "script validation"
sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '374,551p' tests/scripts/derive-mvp-features.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/derive-mvp-features.test.ts
pnpm exec prettier --check tests/scripts/derive-mvp-features.test.ts
```

Expected: every nested validation case passes and the scoped block contains no stale identity.

- [ ] **Step 3: Commit the second independently tested derive-script section**

```bash
git add tests/scripts/derive-mvp-features.test.ts
git commit -m "test: align derive validation pool identity"
```

## Task 6: Update bundle runtime and job fixtures to the canonical pool

**Files:**

- Modify: `tests/scripts/assemble-evidence-bundle.test.ts` (shared `VALID_REQUEST`, plus the runtime and job describe blocks through approximately line 595)

- [ ] **Step 1: Update the shared request and job lineage fixtures**

In the shared `VALID_REQUEST` and both cases under `job forwards an explicit immutable assembly request unchanged`, replace the stale pool ID in feature rows, raw payloads, `makePoolData`, and `makePositionData` with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

Every pool identity participating in a single case must match so the test continues to exercise forwarding and lineage rather than wrong-pool rejection.

- [ ] **Step 2: Run only the runtime/job subset and inspect its range**

Run:

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "runtime composes the bundle repository|job forwards an explicit immutable assembly request unchanged"
sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '80,595p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec prettier --check tests/scripts/assemble-evidence-bundle.test.ts
```

Expected: runtime and job tests pass and their shared-fixture section has one consistent canonical pool.

- [ ] **Step 3: Commit the first independently tested bundle section**

```bash
git add tests/scripts/assemble-evidence-bundle.test.ts
git commit -m "test: update bundle job pool fixtures"
```

## Task 7: Update bundle output-summary fixtures to the canonical pool

**Files:**

- Modify: `tests/scripts/assemble-evidence-bundle.test.ts` (only `script parses required inputs and prints a redacted outcome summary`, approximately lines 596-908)

- [ ] **Step 1: Update input, feature, and raw lineage pool IDs**

Within `describe("script parses required inputs and prints a redacted outcome summary")`, replace the stale pool ID everywhere it appears in request input, candidate features, raw payloads, `makePoolData`, and `makePositionData` with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

Keep wallet redaction and output assertions unchanged.

- [ ] **Step 2: Run only the output-summary describe block and inspect its range**

Run:

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "script parses required inputs and prints a redacted outcome summary"
sed -n '596,908p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '596,908p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec prettier --check tests/scripts/assemble-evidence-bundle.test.ts
```

Expected: both output-summary cases pass and the scoped describe block contains no stale pool.

- [ ] **Step 3: Commit the second independently tested bundle section**

```bash
git add tests/scripts/assemble-evidence-bundle.test.ts
git commit -m "test: update bundle output pool fixtures"
```

## Task 8: Update bundle replay fixtures to the canonical pool

**Files:**

- Modify: `tests/scripts/assemble-evidence-bundle.test.ts` (only `replaying the same input file preserves run and creation identity`, approximately lines 909-1122)

- [ ] **Step 1: Update replay input and lineage pool IDs**

Within `describe("replaying the same input file preserves run and creation identity")`, replace the stale pool ID in input data, feature candidates, raw payloads, `makePoolData`, and `makePositionData` with:

```text
Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE
```

Keep run identity, creation time, replay outcome, and persistence assertions unchanged.

- [ ] **Step 2: Run only the replay describe block and inspect its range**

Run:

```bash
pnpm exec vitest run tests/scripts/assemble-evidence-bundle.test.ts -t "replaying the same input file preserves run and creation identity"
sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
! sed -n '909,1122p' tests/scripts/assemble-evidence-bundle.test.ts | grep -F 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw'
pnpm exec eslint tests/scripts/assemble-evidence-bundle.test.ts
pnpm exec prettier --check tests/scripts/assemble-evidence-bundle.test.ts
```

Expected: the replay test passes and the scoped describe block contains no stale pool identity.

- [ ] **Step 3: Commit the final independently tested bundle section**

```bash
git add tests/scripts/assemble-evidence-bundle.test.ts
git commit -m "test: align bundle replay pool identity"
```

### Tests to add or update

- Add three parser cases in `tests/domain/pool-statistics/orca.test.ts` for non-first selection, absent configured address, and non-array `data`.
- Update `tests/application/collect-orca-pool-statistics.test.ts` to assert the exact endpoint, encoded plural `addresses` parameter, `stats=24h`, timeout, attempt count, pre-persistence rejection, null optional metrics, and unchanged replay/conflict behavior.
- Update `tests/fixtures/orca-pool.ts` to emit `{ data: [pool] }` and the canonical address.
- Keep `tests/domain/pool-statistics/enrich.test.ts` unchanged but execute it as a compatibility check for fixture/parser consumers.
- Update only pool identity values in the scoped sections of `tests/scripts/derive-mvp-features.test.ts` and `tests/scripts/assemble-evidence-bundle.test.ts`; do not weaken their existing assertions.

### Dedicated validation phase commands

After all implementation tasks and their automatic workspace typecheck gates complete, run:

```bash
pnpm verify
git grep -n 'HJPn8wAHkWZ25sfP45Rpggct383GCFU4e43Dmm4D97sw' -- .env.example README.md docs/operator-runbook.md resources/sources.yaml src tests || true
git grep -n '/public/pool' -- src tests resources || true
```

Expected: `pnpm verify` passes; the stale-address search returns no matches in implementation, tests, configuration, or operator docs; the dead endpoint search returns no matches in active source, tests, or resource declarations.

For the issue's live acceptance criterion, an operator with an intentionally configured writable intelligence database and safe non-production environment must update local `WHIRLPOOL_ADDRESS` to the canonical value, then run:

```bash
pnpm collect:core
```

Expected: the printed `orca` outcome is successful (`accepted` or `identical_replay`) rather than 404/unavailable, and volume/fee values are sourced from the explicit 24-hour stats response. This command performs database writes and must not be run against an unintended environment.

### Risk areas

- The live endpoint may change field names beyond the wrapper described by the approved design. In particular, token, timestamp, slot, TVL, or stats fields must not be guessed or translated without verified evidence.
- Returning the first array member would silently associate evidence with the wrong pool; exact address matching is mandatory even when the API appears filtered.
- Omitting `stats=24h` would make every volume/fee value absent. The URL test and source catalog must pin this query parameter.
- `encodeURIComponent(poolAddress)` prevents malformed query values while preserving normal base58 addresses.
- `OrcaPoolResponse.data` is an exported breaking structural type change. All current consumers must compile in the same task; `src/domain/pool-statistics/index.ts` is a pass-through export and should remain unchanged.
- The collector persists raw and normalized observations. Live validation is irreversible at the database level and must use an explicitly selected safe environment.
- Existing deployments retain their local stale address until an operator changes it. Documentation must state this migration requirement.
- The two script test files are large. Restrict each mechanical change to its named describe block and do not combine unrelated cleanup.

### Stop conditions

- Abort implementation if the verified live `/pools?addresses=<canonical-address>&stats=24h` payload does not expose the fields required by `OrcaPoolData`; revise the design with captured evidence instead of fabricating or silently coercing values.
- Abort live validation if the database target, schema permissions, canonical pool address, or non-production safety of the environment cannot be confirmed.
- Abort and re-plan if endpoint support requires a second API request, pagination, authentication changes, a repository-port change, a database migration, or a normalized contract change; each is outside this plan.
- Stop before committing if a changed file contains unrelated user work that cannot be cleanly preserved.
- Stop if the canonical address does not validate as the SOL/USDC pair under the configured SOL and USDC mints.
