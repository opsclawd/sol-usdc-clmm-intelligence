# INT-REPLACE-LEGACY-CLMM-COLLECTOR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-call legacy backend snapshot collector with a single clmm-v2 bundle consumer and remove all legacy recommendation flows in one atomic PR.

**Architecture:** A new `collect-clmm-bundle.ts` application use case fetches the canonical insight bundle from `GET /insights/sol-usdc/bundle/:walletId` (clmm-v2), validates the envelope, and writes `data/latest-clmm-bundle.json`. Simultaneously, 45+ files across the domain, contracts, application, jobs, scripts, routines, prompts, memory, schemas, tests, and fixtures layers are deleted to remove the obsolete daily-insight/range-review/weekly-review/emergency-volatility-check recommendation system. The cron infrastructure (shared, not legacy-specific) is retained. Wiring (barrel exports, npm scripts, env config, docs) is updated to reflect the new single intake path.

**Tech Stack:** TypeScript, Vitest, layered monolith (domain/ports/application/jobs/adapters/node), dependency-cruiser, tsx

---

## File Structure

### New files (5)

| File                                            | Responsibility                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/contracts/clmm-bundle.ts`                  | Canonical persisted bundle contract — one type, no partial views, multi-position           |
| `src/application/collect-clmm-bundle.ts`        | Fetches bundle from clmm-v2, validates envelope, writes JSON                               |
| `src/jobs/clmm-bundle-job.ts`                   | Thin factory: `clmmBundleJob(deps) => () => Promise<void>`                                 |
| `scripts/collectors/clmm-bundle.ts`             | Entrypoint — builds Node runtime, calls the job                                            |
| `tests/application/collect-clmm-bundle.test.ts` | 5 tests: success, missing bundle field, malformed payload, missing API key, trailing slash |

### Modified files (16)

| File                         | Changes                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/contracts/snapshots.ts` | Remove PoolSnapshot, PositionSnapshot, PerformanceSnapshot; keep PriceSnapshot                            |
| `src/contracts/index.ts`     | Remove outputs.ts re-export; add clmm-bundle.ts                                                           |
| `src/jobs/index.ts`          | Remove 4 legacy exports; add clmmBundleJob                                                                |
| `package.json`               | Rename `collect:backend` → `collect:clmm-bundle`; remove `insight:daily`, `review:range`, `review:weekly` |
| `.env.example`               | Add `CLMM_INSIGHTS_API_KEY`; add comment about it                                                         |
| `resources/sources.yaml`     | Replace `backend-clmm-api` with `clmm-v2` (only bundle-provided claims)                                   |
| `cron/jobs.yaml`             | Remove all 4 legacy cron jobs (keep defaults section)                                                     |
| `AGENTS.md`                  | Remove #14 from issues; update domain/contracts descriptions; remove recommendation language              |
| `README.md`                  | Remove deleted script commands; update data flow; remove promotion path                                   |
| `docs/architecture.md`       | Update data flow diagram; update layered monolith descriptions                                            |
| `docs/operator-runbook.md`   | Remove `pnpm collect:backend` troubleshooting; remove `pnpm insight:daily` from first-run                 |

### Deleted files (45+)

**Domain (8):** `src/domain/types.ts`, `data-quality.ts`, `range-status.ts`, `fee-classification.ts`, `advisory-policy.ts`, `daily-insight-decision.ts`, `range-review-decision.ts`, `weekly-review-decision.ts`

**Contracts (1):** `src/contracts/outputs.ts`

**Application (4):** `src/application/collect-backend-snapshot.ts`, `generate-daily-insight.ts`, `generate-range-review.ts`, `generate-weekly-review.ts`

**Jobs (4):** `src/jobs/backend-snapshot-job.ts`, `daily-insight-job.ts`, `range-review-job.ts`, `weekly-review-job.ts`

**Scripts (5):** `scripts/collectors/backend-snapshot.ts`, `raydium-placeholder.ts`, `scripts/generate/daily-insight.ts`, `range-review.ts`, `weekly-review.ts`

**Routines (4):** `routines/daily-sol-usdc-insight.md`, `range-review.md`, `emergency-volatility-check.md`, `weekly-performance-review.md`

**Prompts (3):** `prompts/daily-insight.prompt.md`, `volatility-regime.prompt.md`, `weekly-review.prompt.md`

**Memory (4):** `memory/daily-insights.md`, `rebalance-log.md`, `weekly-reviews.md`, `strategy.md`

**Schemas (4):** `schemas/sol-usdc-daily-insight.schema.json`, `rebalance-recommendation.schema.json`, `pool-snapshot.schema.json`, `position-snapshot.schema.json`

**Tests - domain (7):** `tests/domain/advisory-policy.test.ts`, `range-status.test.ts`, `fee-classification.test.ts`, `data-quality.test.ts`, `daily-insight-decision.test.ts`, `range-review-decision.test.ts`, `weekly-review-decision.test.ts`

**Tests - application (4):** `tests/application/collect-backend-snapshot.test.ts`, `generate-daily-insight.test.ts`, `generate-range-review.test.ts`, `generate-weekly-review.test.ts`

**Tests - regression (3):** `tests/regression/daily-insight.fixture.test.ts`, `range-review.fixture.test.ts`, `weekly-review.fixture.test.ts`

**Fixture data (9):** `tests/fixtures/expected/daily-insight-complete.json`, `daily-insight-partial.json`, `daily-insight-stale.json`, `range-review-complete.json`, `range-review-stale.json`, `weekly-review-stale.json`, `tests/fixtures/snapshots/complete/latest-pool-snapshot.json`, `complete/latest-position-snapshot.json`, `partial/latest-pool-snapshot.json`

---

### Task 1: Add the canonical bundle contract

**Files:**

- Create: `src/contracts/clmm-bundle.ts`
- Test: none (pure type definitions)

**Context:** This contract defines the shape of `data/latest-clmm-bundle.json` as persisted by the new collector. It mirrors the clmm-v2 `SolUsdcInsightInputBundleDto` structure but is self-contained — no imports from clmm-v2. It is the inbound wire contract that INT-CORE #7 onward will consume.

- [ ] **Step 1: Create `src/contracts/clmm-bundle.ts`**

```typescript
export interface ClmmBundle {
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  pool: PoolData;
  srLevels: SrLevels | null;
  positions: PositionData[];
  alerts: AlertData[];
  dataQuality: DataQuality;
}

export interface PoolData {
  poolId: string;
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  tokenPairLabel: string;
  currentPrice: number;
  currentPriceLabel: string;
  sqrtPrice: string;
  tickCurrentIndex: number;
  tickSpacing: number;
  feeRate: number;
  feeRateLabel: string;
  poolLiquidity: string;
  priceSource: "orca_whirlpool_sqrt_price";
}

export interface PositionData {
  walletId: string;
  positionId: string;
  poolId: string;
  pair: "SOL/USDC";
  source: "orca";
  observedAtUnixMs: number;
  rangeState: "in-range" | "below-range" | "above-range";
  lowerTick: number;
  upperTick: number;
  currentTick: number;
  lowerPriceLabel: string;
  upperPriceLabel: string;
  currentPrice: number;
  currentPriceLabel: string;
  rangeDistance: {
    belowLowerTickPercent: number;
    aboveUpperTickPercent: number;
    belowLowerPricePercent?: number;
    aboveUpperPricePercent?: number;
  };
  feeRateLabel: string;
  unclaimedFees: {
    feeOwedA: FeeAmount;
    feeOwedB: FeeAmount;
  };
  unclaimedRewards: RewardAmount[];
  unclaimedFeesUsd: number | null;
  unclaimedRewardsUsd: number | null;
  positionLiquidity: string;
  poolLiquidity: string;
  hasActionableTrigger: boolean;
  triggerId?: string;
  breachDirection?: "lower-bound-breach" | "upper-bound-breach";
}

export interface FeeAmount {
  raw: string;
  decimals: number | null;
  symbol: string;
  mint: string;
}

export interface RewardAmount {
  mint: string;
  raw: string;
  decimals: number | null;
  symbol: string;
}

export interface SrLevels {
  briefId: string;
  sourceRecordedAtIso: string | null;
  summary: string | null;
  capturedAtUnixMs: number;
  supports: SrLevel[];
  resistances: SrLevel[];
}

export interface SrLevel {
  price: number;
  rank?: string;
  timeframe?: string;
  invalidation?: number;
  notes?: string;
}

export interface AlertData {
  triggerId: string;
  positionId: string;
  breachDirection: "lower-bound-breach" | "upper-bound-breach";
  triggeredAt: number;
}

export interface DataQuality {
  warnings: string[];
  isPartial: boolean;
  missingSources: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/contracts/clmm-bundle.ts
git commit -m "feat: add canonical ClmmBundle contract type"
```

---

### Task 2: Write bundle collector tests (TDD — fail first)

**Files:**

- Create: `tests/application/collect-clmm-bundle.test.ts`

**Context:** The new collector does a single HTTP call with auth headers, validates the envelope, and writes the bundle. Five scenarios need testing. The FakeHttp uses URL-based response matching; the FakeJsonStore records writes. The collector throws on failure (unlike the legacy collector which collected errors).

- [ ] **Step 1: Write `tests/application/collect-clmm-bundle.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { collectClmmBundle } from "../../src/application/collect-clmm-bundle.js";
import { FakeHttp, FakeJsonStore, FakeEnv } from "../fakes/index.js";

const VALID_ENV = {
  CLMM_DATA_API_BASE: "http://api.test",
  CLMM_INSIGHTS_API_KEY: "test-key-123",
  WALLET_PUBLIC_KEY: "11111111111111111111111111111111"
};

const VALID_BUNDLE = {
  bundle: {
    pair: "SOL/USDC",
    source: "orca",
    observedAtUnixMs: 1700000000000,
    pool: {
      poolId: "abc",
      currentPrice: 150.5,
      currentPriceLabel: "$150.50",
      sqrtPrice: "1000000",
      tickCurrentIndex: 0,
      tickSpacing: 64,
      feeRate: 0.0005,
      feeRateLabel: "0.05%",
      poolLiquidity: "1000000",
      priceSource: "orca_whirlpool_sqrt_price",
      tokenPairLabel: "SOL/USDC"
    },
    srLevels: null,
    positions: [],
    alerts: [],
    dataQuality: { warnings: [], isPartial: false, missingSources: [] }
  }
};

describe("collectClmmBundle", () => {
  it("writes bundle when all sources succeed", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: VALID_BUNDLE
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await collectClmmBundle({ http, jsonStore, env });

    expect(jsonStore.writes).toHaveLength(1);
    expect(jsonStore.writes[0]!.path).toBe("data/latest-clmm-bundle.json");
    expect(jsonStore.writes[0]!.value).toMatchObject({
      pair: "SOL/USDC",
      positions: []
    });
  });

  it("throws when response envelope lacks bundle field", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: { something: "else" }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow(/bundle/);
  });

  it("throws when bundle payload has malformed structure", async () => {
    const http = new FakeHttp();
    http.setResponse("http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111", {
      body: { bundle: { pair: "ETH/BTC" } }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv(VALID_ENV);

    await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow(/pair/);
  });

  it("throws when CLMM_INSIGHTS_API_KEY is unset", async () => {
    await expect(
      collectClmmBundle({
        http: new FakeHttp(),
        jsonStore: new FakeJsonStore(),
        env: new FakeEnv({ ...VALID_ENV, CLMM_INSIGHTS_API_KEY: undefined })
      })
    ).rejects.toThrow("Missing required environment variable: CLMM_INSIGHTS_API_KEY");
  });

  it("normalises trailing slash on base URL", async () => {
    const http = new FakeHttp();
    const expectedUrl = "http://api.test/insights/sol-usdc/bundle/11111111111111111111111111111111";
    http.setResponse(expectedUrl, { body: VALID_BUNDLE });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ ...VALID_ENV, CLMM_DATA_API_BASE: "http://api.test/" });

    await collectClmmBundle({ http, jsonStore, env });

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]!.url).toBe(expectedUrl);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm test -- tests/application/collect-clmm-bundle.test.ts
```

Expected: `FAIL` — module not found for `collectClmmBundle`

---

### Task 3: Implement the bundle collector

**Files:**

- Create: `src/application/collect-clmm-bundle.ts`

- [ ] **Step 1: Create `src/application/collect-clmm-bundle.ts`**

```typescript
import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { ClmmBundle } from "../contracts/clmm-bundle.js";

export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";

function validateEnvelope(raw: unknown): ClmmBundle {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || !obj.bundle) {
    throw new Error("Response envelope missing 'bundle' field");
  }
  const bundle = obj.bundle as Record<string, unknown>;
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Bundle field is not an object");
  }
  if (bundle.pair !== "SOL/USDC") {
    throw new Error(`Expected pair SOL/USDC, got ${String(bundle.pair)}`);
  }
  if (!bundle.pool || typeof bundle.pool !== "object") {
    throw new Error("Bundle missing pool data");
  }
  if (!Array.isArray(bundle.positions)) {
    throw new Error("Bundle positions is not an array");
  }
  return bundle as unknown as ClmmBundle;
}

export async function collectClmmBundle(deps: CollectClmmBundleDeps): Promise<void> {
  const { http, jsonStore, env } = deps;

  const base = env.get("CLMM_DATA_API_BASE").replace(/\/$/, "");
  const apiKey = env.get("CLMM_INSIGHTS_API_KEY");
  const walletId = env.get("WALLET_PUBLIC_KEY");

  const url = `${base}/insights/sol-usdc/bundle/${walletId}`;
  const response = await http.getJson<unknown>(url, {
    "x-insights-api-key": apiKey
  });

  const bundle = validateEnvelope(response);
  const { bundle: _unused, ...rest } = response as Record<string, unknown>;
  await jsonStore.writeJson(CLMM_BUNDLE_PATH, bundle);
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm test -- tests/application/collect-clmm-bundle.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/application/collect-clmm-bundle.ts tests/application/collect-clmm-bundle.test.ts
git commit -m "feat: add collect-clmm-bundle use case with envelope validation"
```

---

### Task 4: Wire up job factory and entrypoint

**Files:**

- Create: `src/jobs/clmm-bundle-job.ts`
- Create: `scripts/collectors/clmm-bundle.ts`

**Context:** Following the pattern of `backend-snapshot-job.ts` and its script entrypoint.

- [ ] **Step 1: Create `src/jobs/clmm-bundle-job.ts`**

```typescript
import { collectClmmBundle } from "../application/collect-clmm-bundle.js";
import type { CollectClmmBundleDeps } from "../application/collect-clmm-bundle.js";

export function clmmBundleJob(deps: CollectClmmBundleDeps) {
  return () => collectClmmBundle(deps);
}
```

- [ ] **Step 2: Create `scripts/collectors/clmm-bundle.ts`**

```typescript
import "dotenv/config";
import { createNodeRuntime } from "../../src/adapters/node/index.js";
import { clmmBundleJob } from "../../src/jobs/index.js";

const { http, jsonStore, env } = createNodeRuntime();

const job = clmmBundleJob({ http, jsonStore, env });

try {
  await job();
} catch (err) {
  console.error("collect:clmm-bundle failed:", err);
  process.exitCode = 1;
}
```

- [ ] **Step 3: Verify the entrypoint parses correctly**

```bash
pnpm typecheck
```

Expected: PASS (no type errors)

- [ ] **Step 4: Commit**

```bash
git add src/jobs/clmm-bundle-job.ts scripts/collectors/clmm-bundle.ts
git commit -m "feat: add clmm-bundle-job and collect:clmm-bundle entrypoint"
```

---

### Task 5: Delete legacy domain modules

**Files:**

- Delete: `src/domain/types.ts`
- Delete: `src/domain/data-quality.ts`
- Delete: `src/domain/range-status.ts`
- Delete: `src/domain/fee-classification.ts`
- Delete: `src/domain/advisory-policy.ts`
- Delete: `src/domain/daily-insight-decision.ts`
- Delete: `src/domain/range-review-decision.ts`
- Delete: `src/domain/weekly-review-decision.ts`

**Context:** All 8 domain files are only consumed by the 3 legacy recommendation flows. No surviving code imports them. Delete them all at once; the typecheck will confirm nothing is orphaned.

- [ ] **Step 1: Delete all 8 domain files**

```bash
rm src/domain/types.ts \
   src/domain/data-quality.ts \
   src/domain/range-status.ts \
   src/domain/fee-classification.ts \
   src/domain/advisory-policy.ts \
   src/domain/daily-insight-decision.ts \
   src/domain/range-review-decision.ts \
   src/domain/weekly-review-decision.ts
```

- [ ] **Step 2: Verify typecheck passes (no dangling imports)**

```bash
pnpm typecheck
```

Expected: PASS (no errors about missing domain modules)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy recommendation domain modules"
```

---

### Task 6: Delete legacy contracts, application, and jobs

**Files:**

- Delete: `src/contracts/outputs.ts`
- Modify: `src/contracts/snapshots.ts` — trim to only PriceSnapshot
- Delete: `src/application/collect-backend-snapshot.ts`
- Delete: `src/application/generate-daily-insight.ts`
- Delete: `src/application/generate-range-review.ts`
- Delete: `src/application/generate-weekly-review.ts`
- Delete: `src/jobs/backend-snapshot-job.ts`
- Delete: `src/jobs/daily-insight-job.ts`
- Delete: `src/jobs/range-review-job.ts`
- Delete: `src/jobs/weekly-review-job.ts`

- [ ] **Step 1: Delete legacy application files**

```bash
rm src/application/collect-backend-snapshot.ts \
   src/application/generate-daily-insight.ts \
   src/application/generate-range-review.ts \
   src/application/generate-weekly-review.ts
```

- [ ] **Step 2: Delete legacy job files**

```bash
rm src/jobs/backend-snapshot-job.ts \
   src/jobs/daily-insight-job.ts \
   src/jobs/range-review-job.ts \
   src/jobs/weekly-review-job.ts
```

- [ ] **Step 3: Delete legacy contracts file**

```bash
rm src/contracts/outputs.ts
```

- [ ] **Step 4: Trim `src/contracts/snapshots.ts` to only PriceSnapshot**

Replace entire file content:

```typescript
export interface PriceSnapshot {
  pair: "SOL/USDC";
  timestamp: string;
  source: string;
  priceUsd: number;
  confidence?: "low" | "medium" | "high";
  raw?: unknown;
}
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy application, job, and contract files"
```

---

### Task 7: Delete legacy scripts, routines, prompts, memory, and schemas

**Files:**

- Delete: `scripts/collectors/backend-snapshot.ts`
- Delete: `scripts/collectors/raydium-placeholder.ts`
- Delete: `scripts/generate/daily-insight.ts`
- Delete: `scripts/generate/range-review.ts`
- Delete: `scripts/generate/weekly-review.ts`
- Delete: `routines/daily-sol-usdc-insight.md`
- Delete: `routines/range-review.md`
- Delete: `routines/emergency-volatility-check.md`
- Delete: `routines/weekly-performance-review.md`
- Delete: `prompts/daily-insight.prompt.md`
- Delete: `prompts/volatility-regime.prompt.md`
- Delete: `prompts/weekly-review.prompt.md`
- Delete: `memory/daily-insights.md`
- Delete: `memory/rebalance-log.md`
- Delete: `memory/weekly-reviews.md`
- Delete: `memory/strategy.md`
- Delete: `schemas/sol-usdc-daily-insight.schema.json`
- Delete: `schemas/rebalance-recommendation.schema.json`
- Delete: `schemas/pool-snapshot.schema.json`
- Delete: `schemas/position-snapshot.schema.json`

- [ ] **Step 1: Delete all legacy scripts**

```bash
rm scripts/collectors/backend-snapshot.ts \
   scripts/collectors/raydium-placeholder.ts \
   scripts/generate/daily-insight.ts \
   scripts/generate/range-review.ts \
   scripts/generate/weekly-review.ts
```

- [ ] **Step 2: Delete all legacy routines**

```bash
rm routines/daily-sol-usdc-insight.md \
   routines/range-review.md \
   routines/emergency-volatility-check.md \
   routines/weekly-performance-review.md
```

- [ ] **Step 3: Delete all legacy prompts**

```bash
rm prompts/daily-insight.prompt.md \
   prompts/volatility-regime.prompt.md \
   prompts/weekly-review.prompt.md
```

- [ ] **Step 4: Delete legacy memory files (keep lessons-learned.md)**

```bash
rm memory/daily-insights.md \
   memory/rebalance-log.md \
   memory/weekly-reviews.md \
   memory/strategy.md
```

- [ ] **Step 5: Delete legacy schemas (keep price-snapshot.schema.json)**

```bash
rm schemas/sol-usdc-daily-insight.schema.json \
   schemas/rebalance-recommendation.schema.json \
   schemas/pool-snapshot.schema.json \
   schemas/position-snapshot.schema.json
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy scripts, routines, prompts, memory, and schemas"
```

---

### Task 8: Delete legacy tests and fixtures

**Files:**

- Delete: 7 domain test files
- Delete: 4 application test files
- Delete: 3 regression test files
- Delete: 9 fixture data files

- [ ] **Step 1: Delete all legacy test files**

```bash
rm tests/domain/advisory-policy.test.ts \
   tests/domain/range-status.test.ts \
   tests/domain/fee-classification.test.ts \
   tests/domain/data-quality.test.ts \
   tests/domain/daily-insight-decision.test.ts \
   tests/domain/range-review-decision.test.ts \
   tests/domain/weekly-review-decision.test.ts \
   tests/application/collect-backend-snapshot.test.ts \
   tests/application/generate-daily-insight.test.ts \
   tests/application/generate-range-review.test.ts \
   tests/application/generate-weekly-review.test.ts \
   tests/regression/daily-insight.fixture.test.ts \
   tests/regression/range-review.fixture.test.ts \
   tests/regression/weekly-review.fixture.test.ts
```

- [ ] **Step 2: Delete legacy fixture data**

```bash
rm tests/fixtures/expected/daily-insight-complete.json \
   tests/fixtures/expected/daily-insight-partial.json \
   tests/fixtures/expected/daily-insight-stale.json \
   tests/fixtures/expected/range-review-complete.json \
   tests/fixtures/expected/range-review-stale.json \
   tests/fixtures/expected/weekly-review-stale.json \
   tests/fixtures/snapshots/complete/latest-pool-snapshot.json \
   tests/fixtures/snapshots/complete/latest-position-snapshot.json \
   tests/fixtures/snapshots/partial/latest-pool-snapshot.json
```

- [ ] **Step 3: Verify typecheck and tests pass**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS. The test run will only include surviving tests (cron infrastructure, jupiter price, ancillary collectors, new bundle collector). `passWithNoTests: true` means it won't fail if domain test dir is empty.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy tests and fixtures"
```

---

### Task 9: Update wiring and configuration

**Files:**

- Modify: `src/jobs/index.ts`
- Modify: `src/contracts/index.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `resources/sources.yaml`
- Modify: `cron/jobs.yaml`

- [ ] **Step 1: Update `src/jobs/index.ts`**

Replace entire file:

```typescript
export { clmmBundleJob } from "./clmm-bundle-job.js";
export { jupiterPriceJob } from "./jupiter-price-job.js";
export { cronRenderJob } from "./cron-render-job.js";
export { cronSyncJob } from "./cron-sync-job.js";
export { coingeckoJob } from "./coingecko-job.js";
export { defillamaJob } from "./defillama-job.js";
```

- [ ] **Step 2: Update `src/contracts/index.ts`**

Replace entire file:

```typescript
export * from "./clmm-bundle.js";
export * from "./snapshots.js";
export * from "./cron-config.js";
```

- [ ] **Step 3: Update `package.json` scripts section**

Change lines 9-13:

```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "collect:price": "tsx scripts/collectors/jupiter-price.ts",
    "collect:clmm-bundle": "tsx scripts/collectors/clmm-bundle.ts",
    "cron:render": "tsx scripts/openclaw/render-cron-commands.ts",
    "cron:sync": "tsx scripts/openclaw/sync-cron.ts",
```

(Remove `collect:backend`, `insight:daily`, `review:range`, `review:weekly`)

- [ ] **Step 4: Update `.env.example`**

Add the new API key after `CLMM_DATA_API_BASE`:

```
# Backend that owns deterministic CLMM data/calculations.
CLMM_DATA_API_BASE=http://localhost:3001

# API key for clmm-v2 /insights/sol-usdc/* endpoints.
CLMM_INSIGHTS_API_KEY=
```

Leave the rest of the file unchanged.

- [ ] **Step 5: Update `resources/sources.yaml`**

Replace the `backend-clmm-api` entry (lines 2-11) with:

```yaml
- name: clmm-v2
  priority: critical
  type: internal-api
  env: CLMM_DATA_API_BASE
  purpose:
    - pool_state
    - positions
    - alerts
    - sr_context
    - data_quality_warnings
```

- [ ] **Step 6: Update `cron/jobs.yaml`**

Remove the `jobs:` list entirely (lines 10-31). Keep the defaults section. Replace the file with:

```yaml
timezone: America/Edmonton
session: isolated
modelEnv: OPENCLAW_MODEL
thinkingEnv: OPENCLAW_THINKING
agentEnv: OPENCLAW_AGENT
exactEnv: OPENCLAW_EXACT
delivery:
  channelEnv: OPENCLAW_DELIVERY_CHANNEL
  toEnv: OPENCLAW_DELIVERY_TO
```

- [ ] **Step 7: Verify everything compiles**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: update wiring, npm scripts, env config, and sources"
```

---

### Task 10: Update documentation

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Update `AGENTS.md`**

Changes:

1. Remove `#14` from the Key Issues list (line 95, the line `- **INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS #14** — Cleanup after new path is live`)
2. Update `#4` description to: `- **INT-REPLACE-LEGACY-CLMM-COLLECTOR #4** — Clmm-v2 bundle collector, legacy flows removed`
3. Update `src/domain` bullet (line 35) to remove "range status, fee classification, data-quality, advisory policy" from the description. Change to: `- src/domain — pure decision logic (cron command building). No I/O, no clock, no env.`
4. Update `src/contracts` bullet (line 34) to: `- src/contracts — canonical incoming bundle contract, price snapshot type, cron config types, and eventual evidence taxonomy types (INT-TAXONOMY #6)`
5. Remove the Decision Hierarchy section (lines 97-104, `## Decision Hierarchy` through the list) — this repo no longer makes recommendations

- [ ] **Step 2: Update `README.md`**

Changes:

1. Remove lines 34-37 (`pnpm insight:daily`, `pnpm review:range`, `pnpm review:weekly`)
2. Rename `pnpm collect:backend` reference if any
3. Update "Useful commands" section to only show:

```
pnpm collect:price        # writes data/latest-price-snapshot.json from Jupiter
pnpm collect:clmm-bundle  # writes data/latest-clmm-bundle.json from clmm-v2
pnpm cron:render          # prints OpenClaw cron add commands
pnpm cron:sync -- --apply # actually creates OpenClaw cron jobs
```

4. Remove the Promotion Path section (lines 103-110, `## Promotion path` through "gambling with automation")
5. Update the Minimal setup section — remove `pnpm insight:daily`, replace with `pnpm collect:clmm-bundle`
6. Update the system boundary diagram — replace "Fastify backend" with "clmm-v2 backend"
7. Remove `outputs/` from repo layout if no longer relevant

- [ ] **Step 3: Update `docs/architecture.md`**

Changes:

1. Update the data flow diagram at the bottom (lines 74-86) — replace `Fastify CLMM backend + database` → `clmm-v2 backend` and `repo scripts collect snapshots` → `repo collects canonical bundle`
2. Update the layered monolith description (lines 18-23):
   - Remove "daily / range / weekly decision assembly" from domain description
   - Remove "generate daily/range/weekly reviews" from application description
   - Update contracts description: "typed snapshot input shapes" → "canonical incoming bundle contract, price snapshot type, and cron config types"
3. Remove issue #14 reference from the Downstream split section (line 35-36). Change to: "Evidence-bundle publication is INT-PUBLISH (issue #13)."

- [ ] **Step 4: Update `docs/operator-runbook.md`**

Changes:

1. Remove line 13: `If pnpm collect:backend fails, your Fastify backend endpoint is not ready or CLMM_DATA_API_BASE is wrong.`
2. Update the First run section (lines 9-11): remove `pnpm insight:daily`
3. Remove the "Bad recommendation" failure mode section (lines 53-54)
4. Update the "Missing data" section to remove recommendation-oriented language ("hold", "watch", "pause_rebalances")

- [ ] **Step 5: Final verify**

```bash
pnpm verify
```

Expected: PASS (typecheck, lint, format, test, boundaries)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: update AGENTS.md, README, architecture.md, and operator-runbook"
```

---

### Task 11: Final verification and issue status update

- [ ] **Step 1: Run full verification suite**

```bash
pnpm verify
```

Expected: PASS

- [ ] **Step 2: Verify no stale imports remain**

```bash
pnpm boundaries
```

Expected: PASS (no layer violations)

- [ ] **Step 3: Confirm legacy artifact no longer written**

```bash
ls data/latest-pool-snapshot.json 2>&1 || echo "File removed (expected)"
ls data/latest-position-snapshot.json 2>&1 || echo "File removed (expected)"
ls data/latest-performance-snapshot.json 2>&1 || echo "File removed (expected)"
ls data/latest-price-snapshot.json 2>&1 && echo "Price file exists (expected)"
```

Expected: pool, position, performance files do not exist; price file exists

- [ ] **Step 4: Update issue #14 blocker text**

Update the GitHub issue #14 description to: "CLOSED — scope folded into #4. Both closed by PR #N."
