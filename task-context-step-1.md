# Task Context: Task 1

Title: Parse and fixture Orca array responses

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

## Repository Targets

### Expected Files

- src/domain/pool-statistics/orca.ts
- tests/fixtures/orca-pool.ts
- tests/domain/pool-statistics/orca.test.ts
- tests/application/collect-orca-pool-statistics.test.ts

### Reference Files

- src/domain/pool-statistics/index.ts
- tests/domain/pool-statistics/enrich.test.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/pool-statistics/orca.test.ts tests/domain/pool-statistics/enrich.test.ts tests/application/collect-orca-pool-statistics.test.ts
["pnpm","exec","eslint","src/domain/pool-statistics/orca.ts","tests/fixtures/orca-pool.ts","tests/domain/pool-statistics/orca.test.ts","tests/application/collect-orca-pool-statistics.test.ts"]
["pnpm","exec","prettier","--check","src/domain/pool-statistics/orca.ts","tests/fixtures/orca-pool.ts","tests/domain/pool-statistics/orca.test.ts","tests/application/collect-orca-pool-statistics.test.ts"]
pnpm exec tsc --noEmit
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **configured-address selection**: When the response array contains unrelated entries and the configured pool, select the exact configured address regardless of array position. (Test: `selects the configured pool from a multi-pool response before validating it`)
- **missing-address rejection**: When the response array does not contain the configured address, throw OrcaPoolValidationError for address and never use the first entry as a fallback. (Test: `rejects an array that does not contain the configured pool address`)
- **wrapper-shape rejection**: When response.data is not an array, throw OrcaPoolValidationError for data before pool field validation. (Test: `rejects a response whose data member is not an array`)
