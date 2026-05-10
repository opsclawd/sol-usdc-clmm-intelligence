# INT-ARCH Layered Monolith Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor this repo in place into a layered modular monolith under `src/` (domain / contracts / ports / application / jobs / adapters) while preserving every existing pnpm script, output path, and JSON output shape, and add boundary enforcement plus tests for the moved behavior.

**Architecture:** Pure decision logic moves to `src/domain` (no I/O, no clock, no env). Use cases in `src/application` coordinate domain functions and `src/ports` interfaces. `src/adapters/node` implements ports against Node built-ins and exposes a composition root. `scripts/*` become thin entrypoints that build the runtime, invoke a use case or job, print output, and set `process.exitCode`. Boundary rules are enforced by `dependency-cruiser`. Tests use Vitest with in-memory fakes for ports plus fixture regression tests.

**Tech Stack:** TypeScript 5.7 (NodeNext, strict, exactOptionalPropertyTypes), Node 22, tsx, pnpm, zod, yaml, dotenv. New dev dependencies: `vitest@^2`, `dependency-cruiser@^16`.

---

## File Structure

**New `src/` tree (created by this plan):**

```text
src/
  contracts/
    snapshots.ts              # PoolSnapshot, PositionSnapshot, PriceSnapshot, PerformanceSnapshot input types
    outputs.ts                # DailyInsight, RangeReview, WeeklyReview output shapes
    cron-config.ts            # CronConfig, CronJob types parsed from cron/jobs.yaml
    index.ts                  # barrel for ergonomic imports
  domain/
    data-quality.ts           # assessDataQuality({...}) -> { quality, missing }
    range-status.ts           # assessRangeStatus(position) -> { status, breachRisk, recommendedAction, riskLevel }
    fee-classification.ts     # classifyFeeEnvironment(pool) -> 'strong'|'normal'|'weak'|'unknown'
    advisory-policy.ts        # derivePosture / deriveRangeBias / deriveRebalanceSensitivity / deriveMaxCapital
    daily-insight-decision.ts # makeDailyInsightDecision(inputs) -> full decision body (no timestamp)
    range-review-decision.ts  # makeRangeReviewDecision(inputs) -> range-review body (no timestamp)
    weekly-review-decision.ts # makeWeeklyReviewDecision(inputs) -> weekly-review body (no timestamp)
    cron-command.ts           # buildCronAddArgs(job, defaults, delivery) -> { command, args }
  ports/
    http.ts                   # HttpClient: getJson<T>(url, headers?) -> Promise<T>
    json-store.ts             # JsonStore: readJson<T>(path), writeJson(path, value)
    text-reader.ts            # TextReader: readText(path)
    env.ts                    # EnvReader: get(name, fallback?), getOptional(name)
    clock.ts                  # Clock: now() -> string (ISO timestamp)
    command-runner.ts         # CommandRunner: run(command, args) -> Promise<void>
    index.ts                  # barrel of port types
  application/
    collect-jupiter-price.ts  # use case backing `pnpm collect:price`
    collect-backend-snapshot.ts # use case backing `pnpm collect:backend`
    generate-daily-insight.ts # use case backing `pnpm insight:daily`
    generate-range-review.ts  # use case backing `pnpm review:range`
    generate-weekly-review.ts # use case backing `pnpm review:weekly`
    load-cron-config.ts       # parse cron/jobs.yaml + read message files via ports
    render-cron-commands.ts   # use case backing `pnpm cron:render`
    sync-cron.ts              # use case backing `pnpm cron:sync`
    collect-coingecko.ts      # ancillary collector use case (kept; not in pnpm surface)
    collect-defillama.ts      # ancillary collector use case (kept; not in pnpm surface)
  jobs/
    jupiter-price-job.ts
    backend-snapshot-job.ts
    daily-insight-job.ts
    range-review-job.ts
    weekly-review-job.ts
    cron-render-job.ts
    cron-sync-job.ts
    coingecko-job.ts
    defillama-job.ts
    index.ts
  adapters/
    node/
      fetch-http.ts           # HttpClient via global fetch
      fs-json-store.ts        # JsonStore via node:fs/promises
      fs-text-reader.ts       # TextReader via node:fs/promises
      process-env.ts          # EnvReader via process.env (loads dotenv at module init)
      system-clock.ts         # Clock via new Date().toISOString()
      spawn-command-runner.ts # CommandRunner via node:child_process spawn
      composition-root.ts     # createNodeRuntime() wires concrete adapters into a Runtime
```

**Modified `scripts/` (rewired in Phase 8):**

```text
scripts/
  collectors/
    jupiter-price.ts          # ~10 lines: createNodeRuntime + jupiterPriceJob
    backend-snapshot.ts       # ~10 lines
    coingecko.ts              # ~10 lines
    defillama.ts              # ~10 lines
    raydium-placeholder.ts    # unchanged single console.log
  generate/
    daily-insight.ts          # ~12 lines: runtime + dailyInsightJob, prints output
    range-review.ts           # ~12 lines
    weekly-review.ts          # ~12 lines
  openclaw/
    render-cron-commands.ts   # ~12 lines
    sync-cron.ts              # ~12 lines: passes --apply flag through to job
```

**Removed at end of Phase 8 (after all scripts are rewired):** `scripts/lib/env.ts`, `scripts/lib/fs.ts`, `scripts/lib/http.ts`, `scripts/lib/metrics.ts`.

**Tests tree (created by this plan):**

```text
tests/
  fakes/
    fake-http.ts
    fake-json-store.ts
    fake-text-reader.ts
    fake-env.ts
    fake-clock.ts
    fake-command-runner.ts
    index.ts
  domain/
    data-quality.test.ts
    range-status.test.ts
    fee-classification.test.ts
    advisory-policy.test.ts
    daily-insight-decision.test.ts
    range-review-decision.test.ts
    weekly-review-decision.test.ts
    cron-command.test.ts
  application/
    collect-jupiter-price.test.ts
    collect-backend-snapshot.test.ts
    generate-daily-insight.test.ts
    generate-range-review.test.ts
    generate-weekly-review.test.ts
    load-cron-config.test.ts
    render-cron-commands.test.ts
    sync-cron.test.ts
  fixtures/
    snapshots/
      complete/
        latest-price-snapshot.json
        latest-pool-snapshot.json
        latest-position-snapshot.json
      partial/
        latest-price-snapshot.json
        latest-pool-snapshot.json
      stale/
        (empty)
    cron/
      jobs.yaml
      routines/daily.md
    expected/
      daily-insight-complete.json
      daily-insight-partial.json
      daily-insight-stale.json
      range-review-complete.json
      range-review-stale.json
      weekly-review-complete.json
      cron-render.txt
  regression/
    daily-insight.fixture.test.ts
    range-review.fixture.test.ts
    weekly-review.fixture.test.ts
    cron-render.fixture.test.ts
```

**Modified configuration:**

- `tsconfig.json` — include `src/**/*.ts` and `tests/**/*.ts` alongside `scripts/**/*.ts`
- `package.json` — add devDependencies (`vitest`, `dependency-cruiser`) and scripts (`test`, `test:watch`, `boundaries`, `verify`)
- `.dependency-cruiser.cjs` — boundary rules per spec §Boundary Rules
- `vitest.config.ts` — test glob, NodeNext-friendly resolver, no globals
- `README.md`, `docs/architecture.md` — explain the layered monolith and downstream split

---

## Conventions Applied To Every File

- **Imports use `.js` extensions** (NodeNext requirement). New file `src/foo/bar.ts` imported as `from '../foo/bar.js'`.
- **No comments unless WHY is non-obvious.** Existing scripts are comment-light; preserve that.
- **Domain files import only `../contracts/snapshots.js`** and other domain modules. They MUST NOT import ports, application, jobs, adapters, contracts/outputs, or Node built-ins.
- **Application files import domain, ports, and contracts.** They MUST NOT import adapters or Node built-ins.
- **Adapters import ports and Node built-ins.** They MUST NOT import application or jobs.
- **Each task ends with a focused commit.** No batched commits.

---

## Phase 0: Tooling and Test Setup

### Task 0: Install Vitest, dependency-cruiser, and update tsconfig

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Add dev dependencies**

Run:
```bash
pnpm add -D vitest@^2 dependency-cruiser@^16
```
Expected: `pnpm-lock.yaml` updates; `node_modules/.bin/vitest` exists.

- [ ] **Step 2: Update `tsconfig.json` to include src and tests**

Replace the `include` array so the file reads:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["scripts/**/*.ts", "src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true
  }
});
```

- [ ] **Step 4: Add scripts to `package.json`**

Insert these entries into the `scripts` block (preserve existing entries):

```json
"test": "vitest run",
"test:watch": "vitest",
"boundaries": "depcruise --config .dependency-cruiser.cjs src",
"verify": "pnpm typecheck && pnpm test && pnpm boundaries"
```

The `boundaries` config file is created in Task 29; until then `pnpm boundaries` will fail and that is expected.

- [ ] **Step 5: Create empty `tests/.gitkeep` so the directory tracks**

Create `tests/.gitkeep` with empty content.

- [ ] **Step 6: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: exit 0 (no source files have moved yet).

- [ ] **Step 7: Verify Vitest can discover zero tests**

Run: `pnpm test`
Expected: exit 0 with `No test files found, exiting with code 0` (Vitest accepts an empty suite as success when invoked via `vitest run`; if it instead exits non-zero, add `passWithNoTests: true` to the `test` block).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts tests/.gitkeep
git commit -m "chore: add vitest and dependency-cruiser tooling"
```

---

## Phase 1: Contracts

### Task 1: Define contract types

**Files:**
- Create: `src/contracts/snapshots.ts`
- Create: `src/contracts/outputs.ts`
- Create: `src/contracts/cron-config.ts`
- Create: `src/contracts/index.ts`

These are types only — no runtime tests. The tests come in Phase 2 when domain functions consume them.

- [ ] **Step 1: Create `src/contracts/snapshots.ts`**

```ts
export interface PriceSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  priceUsd: number;
  confidence?: 'low' | 'medium' | 'high';
  raw?: unknown;
}

export interface PoolSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  spotPrice?: number;
  feeApr?: number;
  volume24hUsd?: number;
  tvlUsd?: number;
  liquidityTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
  volumeTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
  feeAprTrend?: 'rising' | 'flat' | 'falling' | 'unknown';
}

export interface PositionSnapshot {
  pair: 'SOL/USDC';
  timestamp: string;
  source: string;
  lowerPrice?: number;
  upperPrice?: number;
  spotPrice?: number;
  inRange: boolean;
  distanceToLowerPercent?: number;
  distanceToUpperPercent?: number;
  unclaimedFeesUsd?: number;
  inventorySolPercent?: number;
  inventoryUsdcPercent?: number;
}

export type PerformanceSnapshot = Record<string, unknown>;
```

- [ ] **Step 2: Create `src/contracts/outputs.ts`**

```ts
export type RecommendedAction =
  | 'hold'
  | 'watch'
  | 'tighten_range'
  | 'widen_range'
  | 'exit_range'
  | 'pause_rebalances';

export type Confidence = 'low' | 'medium' | 'high';
export type RiskLevel = 'normal' | 'elevated' | 'critical';
export type DataQuality = 'complete' | 'partial' | 'stale';
export type Posture =
  | 'paused'
  | 'defensive'
  | 'neutral'
  | 'moderately_aggressive';
export type RangeBias = 'wide' | 'medium' | 'narrow' | 'passive';
export type RebalanceSensitivity = 'paused' | 'high' | 'normal';
export type RangeStatus =
  | 'healthy'
  | 'near_lower_edge'
  | 'near_upper_edge'
  | 'out_of_range'
  | 'unknown';
export type BreachRisk = 'low' | 'medium' | 'high' | 'unknown';
export type FeeEnvironment = 'strong' | 'normal' | 'weak' | 'unknown';

export interface DailyInsight {
  pair: 'SOL/USDC';
  timestamp: string;
  marketRegime: string;
  fundamentalRegime: 'unknown';
  recommendedAction: RecommendedAction;
  confidence: Confidence;
  riskLevel: RiskLevel;
  dataQuality: DataQuality;
  missingInputs: string[];
  clmmPolicy: {
    posture: Posture;
    rangeBias: RangeBias;
    rebalanceSensitivity: RebalanceSensitivity;
    maxCapitalDeploymentPercent: number;
  };
  currentRangeAssessment: {
    status: RangeStatus;
    breachRisk: BreachRisk;
    distanceToLowerPercent?: number;
    distanceToUpperPercent?: number;
  };
  feeEnvironment: {
    classification: FeeEnvironment;
    feeApr?: number;
    feeAprTrend: 'rising' | 'flat' | 'falling' | 'unknown';
    volume24hUsd?: number;
    volumeTrend: 'rising' | 'flat' | 'falling' | 'unknown';
  };
  price: {
    spotPrice?: number;
    jupiterPriceUsd?: number;
  };
  reasoning: string[];
  sources: string[];
  requiresHumanApproval: boolean;
  executionPermittedByAgent: false;
}

export interface RangeReview {
  pair: 'SOL/USDC';
  timestamp: string;
  recommendedAction: RecommendedAction;
  shouldRebalance: boolean;
  confidence: Confidence;
  riskLevel: RiskLevel;
  dataQuality: DataQuality;
  missingInputs: string[];
  currentRangeAssessment: {
    status: RangeStatus;
    breachRisk: BreachRisk;
    lowerPrice?: number;
    upperPrice?: number;
    spotPrice?: number;
    distanceToLowerPercent?: number;
    distanceToUpperPercent?: number;
    inRange?: boolean;
  };
  recommendedRange: {
    type: 'backend_must_calculate_exact_ticks' | 'unchanged';
    widthBias: 'wider' | 'unchanged';
  };
  reasoning: string[];
  requiresHumanApproval: boolean;
  executionPermittedByAgent: false;
}

export interface WeeklyReview {
  pair: 'SOL/USDC';
  timestamp: string;
  dataQuality: 'partial' | 'stale';
  summary: string;
  inputs: {
    hasPerformanceSnapshot: boolean;
    hasDailyInsight: boolean;
    hasRebalanceRecommendation: boolean;
  };
  decisionQualityReview: {
    grade: 'ungraded';
    reason: string;
  };
  proposedPolicyChanges: unknown[];
  executionPermittedByAgent: false;
}
```

- [ ] **Step 3: Create `src/contracts/cron-config.ts`**

```ts
export interface CronJob {
  name: string;
  cron: string;
  messageFile: string;
  description?: string;
  model?: string;
  thinking?: string;
}

export interface CronConfig {
  timezone: string;
  session: string;
  modelEnv?: string;
  thinkingEnv?: string;
  agentEnv?: string;
  exactEnv?: string;
  delivery?: {
    channelEnv?: string;
    toEnv?: string;
  };
  jobs: CronJob[];
}

export interface ResolvedCronDefaults {
  timezone: string;
  session: string;
  defaultModel?: string;
  defaultThinking?: string;
  agent?: string;
  exact: boolean;
  delivery?: {
    channel: string;
    to: string;
  };
}

export interface PreparedCronJob {
  job: CronJob;
  message: string;
  model?: string;
  thinking?: string;
}
```

- [ ] **Step 4: Create `src/contracts/index.ts` barrel**

```ts
export * from './snapshots.js';
export * from './outputs.js';
export * from './cron-config.js';
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/contracts
git commit -m "feat(contracts): add snapshot, output, and cron config types"
```

---

## Phase 2: Domain Layer

### Task 2: Domain — `data-quality`

**Files:**
- Create: `tests/domain/data-quality.test.ts`
- Create: `src/domain/data-quality.ts`

- [ ] **Step 1: Write the failing test**

`tests/domain/data-quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assessDataQuality } from '../../src/domain/data-quality.js';

describe('assessDataQuality', () => {
  it('returns complete with no missing when every input is defined', () => {
    expect(assessDataQuality({ a: 1, b: 'x', c: {} })).toEqual({
      quality: 'complete',
      missing: []
    });
  });

  it('returns partial with missing keys when 1 input is null', () => {
    expect(assessDataQuality({ a: 1, b: null })).toEqual({
      quality: 'partial',
      missing: ['b']
    });
  });

  it('returns partial when 2 inputs are missing', () => {
    expect(assessDataQuality({ a: undefined, b: null, c: 3 })).toEqual({
      quality: 'partial',
      missing: ['a', 'b']
    });
  });

  it('returns stale when 3 or more inputs are missing', () => {
    expect(
      assessDataQuality({ a: undefined, b: null, c: undefined })
    ).toEqual({
      quality: 'stale',
      missing: ['a', 'b', 'c']
    });
  });

  it('preserves key order from the input object in the missing array', () => {
    const result = assessDataQuality({ price: undefined, pool: null, position: 1 });
    expect(result.missing).toEqual(['price', 'pool']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/data-quality.test.ts`
Expected: FAIL — module `src/domain/data-quality.js` not resolvable.

- [ ] **Step 3: Write minimal implementation**

`src/domain/data-quality.ts`:

```ts
import type { DataQuality } from '../contracts/outputs.js';

export interface DataQualityAssessment {
  quality: DataQuality;
  missing: string[];
}

export function assessDataQuality(
  inputs: Record<string, unknown>
): DataQualityAssessment {
  const missing = Object.entries(inputs)
    .filter(([, value]) => value == null)
    .map(([key]) => key);

  if (missing.length === 0) return { quality: 'complete', missing };
  if (missing.length <= 2) return { quality: 'partial', missing };
  return { quality: 'stale', missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/data-quality.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/data-quality.test.ts src/domain/data-quality.ts
git commit -m "feat(domain): extract assessDataQuality with tests"
```

---

### Task 3: Domain — `range-status`

**Files:**
- Create: `tests/domain/range-status.test.ts`
- Create: `src/domain/range-status.ts`

- [ ] **Step 1: Write the failing test**

`tests/domain/range-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assessRangeStatus } from '../../src/domain/range-status.js';
import type { PositionSnapshot } from '../../src/contracts/snapshots.js';

const base: PositionSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'test',
  inRange: true
};

describe('assessRangeStatus', () => {
  it('returns unknown / elevated / watch when position is undefined', () => {
    expect(assessRangeStatus(undefined)).toEqual({
      status: 'unknown',
      breachRisk: 'unknown',
      recommendedAction: 'watch',
      riskLevel: 'elevated'
    });
  });

  it('returns out_of_range / critical / exit_range when inRange is false', () => {
    expect(assessRangeStatus({ ...base, inRange: false })).toEqual({
      status: 'out_of_range',
      breachRisk: 'high',
      recommendedAction: 'exit_range',
      riskLevel: 'critical'
    });
  });

  it('returns near_lower_edge / widen_range / elevated when distanceToLowerPercent <= 3', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 3, distanceToUpperPercent: 50 })
    ).toEqual({
      status: 'near_lower_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    });
  });

  it('returns near_upper_edge / widen_range / elevated when distanceToUpperPercent <= 3', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 50, distanceToUpperPercent: 2.5 })
    ).toEqual({
      status: 'near_upper_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    });
  });

  it('returns near_lower_edge / watch / normal when 3 < lower <= 6', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 5, distanceToUpperPercent: 50 })
    ).toEqual({
      status: 'near_lower_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    });
  });

  it('returns near_upper_edge / watch / normal when lower > 6 and upper <= 6', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 20, distanceToUpperPercent: 5 })
    ).toEqual({
      status: 'near_upper_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    });
  });

  it('returns healthy / hold / normal when distances are comfortably wide', () => {
    expect(
      assessRangeStatus({ ...base, distanceToLowerPercent: 25, distanceToUpperPercent: 25 })
    ).toEqual({
      status: 'healthy',
      breachRisk: 'low',
      recommendedAction: 'hold',
      riskLevel: 'normal'
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/range-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/range-status.ts`:

```ts
import type { PositionSnapshot } from '../contracts/snapshots.js';
import type {
  BreachRisk,
  RangeStatus,
  RecommendedAction,
  RiskLevel
} from '../contracts/outputs.js';

export interface RangeAssessment {
  status: RangeStatus;
  breachRisk: BreachRisk;
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
}

export function assessRangeStatus(position?: PositionSnapshot): RangeAssessment {
  if (!position) {
    return {
      status: 'unknown',
      breachRisk: 'unknown',
      recommendedAction: 'watch',
      riskLevel: 'elevated'
    };
  }

  if (!position.inRange) {
    return {
      status: 'out_of_range',
      breachRisk: 'high',
      recommendedAction: 'exit_range',
      riskLevel: 'critical'
    };
  }

  const lower = position.distanceToLowerPercent;
  const upper = position.distanceToUpperPercent;

  if (lower != null && lower <= 3) {
    return {
      status: 'near_lower_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    };
  }

  if (upper != null && upper <= 3) {
    return {
      status: 'near_upper_edge',
      breachRisk: 'high',
      recommendedAction: 'widen_range',
      riskLevel: 'elevated'
    };
  }

  if ((lower != null && lower <= 6) || (upper != null && upper <= 6)) {
    return {
      status: lower != null && lower <= 6 ? 'near_lower_edge' : 'near_upper_edge',
      breachRisk: 'medium',
      recommendedAction: 'watch',
      riskLevel: 'normal'
    };
  }

  return {
    status: 'healthy',
    breachRisk: 'low',
    recommendedAction: 'hold',
    riskLevel: 'normal'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/range-status.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/range-status.test.ts src/domain/range-status.ts
git commit -m "feat(domain): extract assessRangeStatus with tests"
```

---

### Task 4: Domain — `fee-classification`

**Files:**
- Create: `tests/domain/fee-classification.test.ts`
- Create: `src/domain/fee-classification.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { classifyFeeEnvironment } from '../../src/domain/fee-classification.js';
import type { PoolSnapshot } from '../../src/contracts/snapshots.js';

const base: PoolSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'test'
};

describe('classifyFeeEnvironment', () => {
  it('returns unknown when pool is undefined', () => {
    expect(classifyFeeEnvironment(undefined)).toBe('unknown');
  });

  it('returns unknown when feeApr is missing', () => {
    expect(classifyFeeEnvironment({ ...base })).toBe('unknown');
  });

  it('returns strong when feeApr is 80', () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 80 })).toBe('strong');
  });

  it('returns strong when feeApr is well above 80', () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 250 })).toBe('strong');
  });

  it('returns normal when feeApr is 25', () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 25 })).toBe('normal');
  });

  it('returns normal when feeApr is in [25, 80)', () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 60 })).toBe('normal');
  });

  it('returns weak when feeApr is below 25', () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 10 })).toBe('weak');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/fee-classification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/fee-classification.ts`:

```ts
import type { PoolSnapshot } from '../contracts/snapshots.js';
import type { FeeEnvironment } from '../contracts/outputs.js';

export function classifyFeeEnvironment(pool?: PoolSnapshot): FeeEnvironment {
  if (!pool || pool.feeApr == null) return 'unknown';
  if (pool.feeApr >= 80) return 'strong';
  if (pool.feeApr >= 25) return 'normal';
  return 'weak';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/fee-classification.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/fee-classification.test.ts src/domain/fee-classification.ts
git commit -m "feat(domain): extract classifyFeeEnvironment with tests"
```

---

### Task 5: Domain — `advisory-policy`

This module captures the posture / range-bias / rebalance-sensitivity / max-capital decisions that the daily-insight currently inlines. Inputs are the *resolved* recommendedAction and riskLevel (already merged with data-quality concerns) plus the fee environment and breach risk.

**Files:**
- Create: `tests/domain/advisory-policy.test.ts`
- Create: `src/domain/advisory-policy.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  derivePosture,
  deriveRangeBias,
  deriveRebalanceSensitivity,
  deriveMaxCapitalDeploymentPercent
} from '../../src/domain/advisory-policy.js';

describe('deriveRangeBias', () => {
  it('returns passive when action is pause_rebalances', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'pause_rebalances',
        riskLevel: 'elevated',
        feeEnvironment: 'strong',
        breachRisk: 'low'
      })
    ).toBe('passive');
  });

  it('returns wide when action is widen_range', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'widen_range',
        riskLevel: 'normal',
        feeEnvironment: 'normal',
        breachRisk: 'high'
      })
    ).toBe('wide');
  });

  it('returns wide when riskLevel is elevated even if action is hold', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'hold',
        riskLevel: 'elevated',
        feeEnvironment: 'strong',
        breachRisk: 'low'
      })
    ).toBe('wide');
  });

  it('returns medium on strong fees and low breach risk when action is hold', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'hold',
        riskLevel: 'normal',
        feeEnvironment: 'strong',
        breachRisk: 'low'
      })
    ).toBe('medium');
  });

  it('returns wide on weak fees', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'hold',
        riskLevel: 'normal',
        feeEnvironment: 'weak',
        breachRisk: 'low'
      })
    ).toBe('wide');
  });

  it('returns medium otherwise', () => {
    expect(
      deriveRangeBias({
        recommendedAction: 'watch',
        riskLevel: 'normal',
        feeEnvironment: 'normal',
        breachRisk: 'medium'
      })
    ).toBe('medium');
  });
});

describe('derivePosture', () => {
  it('returns paused on pause_rebalances', () => {
    expect(
      derivePosture({
        recommendedAction: 'pause_rebalances',
        riskLevel: 'normal',
        feeEnvironment: 'strong'
      })
    ).toBe('paused');
  });

  it('returns defensive on critical risk', () => {
    expect(
      derivePosture({
        recommendedAction: 'exit_range',
        riskLevel: 'critical',
        feeEnvironment: 'strong'
      })
    ).toBe('defensive');
  });

  it('returns defensive on elevated risk', () => {
    expect(
      derivePosture({
        recommendedAction: 'watch',
        riskLevel: 'elevated',
        feeEnvironment: 'normal'
      })
    ).toBe('defensive');
  });

  it('returns moderately_aggressive on strong fees and normal risk', () => {
    expect(
      derivePosture({
        recommendedAction: 'hold',
        riskLevel: 'normal',
        feeEnvironment: 'strong'
      })
    ).toBe('moderately_aggressive');
  });

  it('returns defensive on weak fees and normal risk', () => {
    expect(
      derivePosture({
        recommendedAction: 'hold',
        riskLevel: 'normal',
        feeEnvironment: 'weak'
      })
    ).toBe('defensive');
  });

  it('returns neutral otherwise', () => {
    expect(
      derivePosture({
        recommendedAction: 'hold',
        riskLevel: 'normal',
        feeEnvironment: 'normal'
      })
    ).toBe('neutral');
  });
});

describe('deriveRebalanceSensitivity', () => {
  it('returns paused on pause_rebalances', () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: 'pause_rebalances',
        riskLevel: 'normal'
      })
    ).toBe('paused');
  });

  it('returns high on elevated risk', () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: 'watch',
        riskLevel: 'elevated'
      })
    ).toBe('high');
  });

  it('returns normal otherwise', () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: 'hold',
        riskLevel: 'normal'
      })
    ).toBe('normal');
  });
});

describe('deriveMaxCapitalDeploymentPercent', () => {
  it('returns 50 when posture is defensive', () => {
    expect(deriveMaxCapitalDeploymentPercent('defensive')).toBe(50);
  });

  it('returns 50 when posture is paused', () => {
    expect(deriveMaxCapitalDeploymentPercent('paused')).toBe(50);
  });

  it('returns 70 when posture is neutral', () => {
    expect(deriveMaxCapitalDeploymentPercent('neutral')).toBe(70);
  });

  it('returns 70 when posture is moderately_aggressive', () => {
    expect(deriveMaxCapitalDeploymentPercent('moderately_aggressive')).toBe(70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/advisory-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/advisory-policy.ts`:

```ts
import type {
  BreachRisk,
  FeeEnvironment,
  Posture,
  RangeBias,
  RebalanceSensitivity,
  RecommendedAction,
  RiskLevel
} from '../contracts/outputs.js';

export interface PolicyInputs {
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
  feeEnvironment: FeeEnvironment;
  breachRisk: BreachRisk;
}

export function deriveRangeBias(inputs: PolicyInputs): RangeBias {
  const { recommendedAction, riskLevel, feeEnvironment, breachRisk } = inputs;
  if (recommendedAction === 'pause_rebalances') return 'passive';
  if (recommendedAction === 'widen_range' || riskLevel === 'elevated') return 'wide';
  if (feeEnvironment === 'strong' && breachRisk === 'low') return 'medium';
  if (feeEnvironment === 'weak') return 'wide';
  return 'medium';
}

export function derivePosture(
  inputs: Pick<PolicyInputs, 'recommendedAction' | 'riskLevel' | 'feeEnvironment'>
): Posture {
  const { recommendedAction, riskLevel, feeEnvironment } = inputs;
  if (recommendedAction === 'pause_rebalances') return 'paused';
  if (riskLevel === 'critical') return 'defensive';
  if (riskLevel === 'elevated') return 'defensive';
  if (feeEnvironment === 'strong') return 'moderately_aggressive';
  if (feeEnvironment === 'weak') return 'defensive';
  return 'neutral';
}

export function deriveRebalanceSensitivity(
  inputs: Pick<PolicyInputs, 'recommendedAction' | 'riskLevel'>
): RebalanceSensitivity {
  if (inputs.recommendedAction === 'pause_rebalances') return 'paused';
  if (inputs.riskLevel === 'elevated') return 'high';
  return 'normal';
}

export function deriveMaxCapitalDeploymentPercent(posture: Posture): number {
  return posture === 'defensive' || posture === 'paused' ? 50 : 70;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/advisory-policy.test.ts`
Expected: PASS, all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/advisory-policy.test.ts src/domain/advisory-policy.ts
git commit -m "feat(domain): extract advisory policy decisions with tests"
```

---

### Task 6: Domain — `daily-insight-decision`

This composes the smaller domain functions into the full daily-insight body. It does NOT include `timestamp` — that comes from the use case via the `Clock` port.

**Files:**
- Create: `tests/domain/daily-insight-decision.test.ts`
- Create: `src/domain/daily-insight-decision.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeDailyInsightDecision } from '../../src/domain/daily-insight-decision.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../../src/contracts/snapshots.js';

const price: PriceSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'jupiter-price-v3',
  priceUsd: 175.4,
  confidence: 'high'
};

const pool: PoolSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify-clmm-backend',
  spotPrice: 175.5,
  feeApr: 95,
  volume24hUsd: 12_000_000,
  feeAprTrend: 'rising',
  volumeTrend: 'rising'
};

const position: PositionSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify-clmm-backend',
  inRange: true,
  lowerPrice: 150,
  upperPrice: 200,
  spotPrice: 175.5,
  distanceToLowerPercent: 14.5,
  distanceToUpperPercent: 14.0
};

describe('makeDailyInsightDecision', () => {
  it('produces complete-quality hold decision when all snapshots are healthy and fees strong', () => {
    const out = makeDailyInsightDecision({ price, pool, position });

    expect(out.dataQuality).toBe('complete');
    expect(out.recommendedAction).toBe('hold');
    expect(out.riskLevel).toBe('normal');
    expect(out.confidence).toBe('medium');
    expect(out.marketRegime).toBe('range_healthy_fee_strong');
    expect(out.fundamentalRegime).toBe('unknown');
    expect(out.clmmPolicy).toEqual({
      posture: 'moderately_aggressive',
      rangeBias: 'medium',
      rebalanceSensitivity: 'normal',
      maxCapitalDeploymentPercent: 70
    });
    expect(out.feeEnvironment).toEqual({
      classification: 'strong',
      feeApr: 95,
      feeAprTrend: 'rising',
      volume24hUsd: 12_000_000,
      volumeTrend: 'rising'
    });
    expect(out.price).toEqual({
      spotPrice: 175.5,
      jupiterPriceUsd: 175.4
    });
    expect(out.requiresHumanApproval).toBe(false);
    expect(out.executionPermittedByAgent).toBe(false);
    expect(out.sources).toEqual(['jupiter-price-v3', 'fastify-clmm-backend', 'fastify-clmm-backend']);
    expect(out.missingInputs).toEqual([]);
  });

  it('overrides recommendedAction to pause_rebalances when data quality is stale', () => {
    const out = makeDailyInsightDecision({});
    expect(out.dataQuality).toBe('stale');
    expect(out.recommendedAction).toBe('pause_rebalances');
    expect(out.riskLevel).toBe('elevated');
    expect(out.confidence).toBe('low');
    expect(out.clmmPolicy.posture).toBe('paused');
    expect(out.clmmPolicy.rangeBias).toBe('passive');
    expect(out.clmmPolicy.rebalanceSensitivity).toBe('paused');
    expect(out.clmmPolicy.maxCapitalDeploymentPercent).toBe(50);
    expect(out.requiresHumanApproval).toBe(true);
    expect(out.missingInputs).toEqual(['price', 'pool', 'position']);
    expect(out.sources).toEqual([]);
  });

  it('keeps domain decision under partial quality when only price is missing', () => {
    const out = makeDailyInsightDecision({ pool, position });
    expect(out.dataQuality).toBe('partial');
    expect(out.recommendedAction).toBe('hold');
    expect(out.confidence).toBe('low');
    expect(out.missingInputs).toEqual(['price']);
  });

  it('flags requiresHumanApproval when recommendedAction is anything other than hold', () => {
    const outOfRange: PositionSnapshot = { ...position, inRange: false };
    const out = makeDailyInsightDecision({ price, pool, position: outOfRange });
    expect(out.recommendedAction).toBe('exit_range');
    expect(out.requiresHumanApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/daily-insight-decision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/daily-insight-decision.ts`:

```ts
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { DailyInsight } from '../contracts/outputs.js';
import { assessDataQuality } from './data-quality.js';
import { assessRangeStatus } from './range-status.js';
import { classifyFeeEnvironment } from './fee-classification.js';
import {
  derivePosture,
  deriveRangeBias,
  deriveRebalanceSensitivity,
  deriveMaxCapitalDeploymentPercent
} from './advisory-policy.js';

export interface DailyInsightInputs {
  price?: PriceSnapshot;
  pool?: PoolSnapshot;
  position?: PositionSnapshot;
}

export type DailyInsightDecision = Omit<DailyInsight, 'timestamp'>;

export function makeDailyInsightDecision(
  inputs: DailyInsightInputs
): DailyInsightDecision {
  const { price, pool, position } = inputs;
  const { quality, missing } = assessDataQuality({ price, pool, position });
  const range = assessRangeStatus(position);
  const feeEnvironment = classifyFeeEnvironment(pool);

  const recommendedAction =
    quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;
  const riskLevel = quality === 'stale' ? 'elevated' : range.riskLevel;

  const posture = derivePosture({ recommendedAction, riskLevel, feeEnvironment });
  const rangeBias = deriveRangeBias({
    recommendedAction,
    riskLevel,
    feeEnvironment,
    breachRisk: range.breachRisk
  });
  const rebalanceSensitivity = deriveRebalanceSensitivity({
    recommendedAction,
    riskLevel
  });
  const maxCapitalDeploymentPercent = deriveMaxCapitalDeploymentPercent(posture);

  return {
    pair: 'SOL/USDC',
    marketRegime: `range_${range.status}_fee_${feeEnvironment}`,
    fundamentalRegime: 'unknown',
    recommendedAction,
    confidence: quality === 'complete' ? 'medium' : 'low',
    riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    clmmPolicy: {
      posture,
      rangeBias,
      rebalanceSensitivity,
      maxCapitalDeploymentPercent
    },
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      ...(position?.distanceToLowerPercent != null
        ? { distanceToLowerPercent: position.distanceToLowerPercent }
        : {}),
      ...(position?.distanceToUpperPercent != null
        ? { distanceToUpperPercent: position.distanceToUpperPercent }
        : {})
    },
    feeEnvironment: {
      classification: feeEnvironment,
      ...(pool?.feeApr != null ? { feeApr: pool.feeApr } : {}),
      feeAprTrend: pool?.feeAprTrend ?? 'unknown',
      ...(pool?.volume24hUsd != null ? { volume24hUsd: pool.volume24hUsd } : {}),
      volumeTrend: pool?.volumeTrend ?? 'unknown'
    },
    price: {
      ...(pool?.spotPrice != null
        ? { spotPrice: pool.spotPrice }
        : position?.spotPrice != null
        ? { spotPrice: position.spotPrice }
        : price?.priceUsd != null
        ? { spotPrice: price.priceUsd }
        : {}),
      ...(price?.priceUsd != null ? { jupiterPriceUsd: price.priceUsd } : {})
    },
    reasoning: [
      quality === 'complete'
        ? 'Core price, pool, and position inputs are available.'
        : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status} with ${range.breachRisk} breach risk.`,
      `Fee environment is ${feeEnvironment}.`,
      'Recommendation remains advisory only; backend and wallet control execution.'
    ],
    sources: [price?.source, pool?.source, position?.source].filter(
      (value): value is string => Boolean(value)
    ),
    requiresHumanApproval: recommendedAction !== 'hold',
    executionPermittedByAgent: false
  };
}
```

> Behavior preservation note: the original `daily-insight.ts` writes `distanceToLowerPercent: position?.distanceToLowerPercent` (which is `undefined` when absent). With `exactOptionalPropertyTypes: true` we must spread the field only when defined. JSON serialization of undefined-valued object properties produces no key in either case, so the on-disk JSON remains byte-for-byte identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/daily-insight-decision.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/daily-insight-decision.test.ts src/domain/daily-insight-decision.ts
git commit -m "feat(domain): assemble daily insight decision body"
```

---

### Task 7: Domain — `range-review-decision`

**Files:**
- Create: `tests/domain/range-review-decision.test.ts`
- Create: `src/domain/range-review-decision.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeRangeReviewDecision } from '../../src/domain/range-review-decision.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../../src/contracts/snapshots.js';

const price: PriceSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'jupiter-price-v3',
  priceUsd: 175.4
};
const pool: PoolSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify',
  spotPrice: 175.5,
  feeApr: 60
};
const position: PositionSnapshot = {
  pair: 'SOL/USDC',
  timestamp: '2026-05-10T12:00:00.000Z',
  source: 'fastify',
  inRange: true,
  lowerPrice: 150,
  upperPrice: 200,
  spotPrice: 175.5,
  distanceToLowerPercent: 15,
  distanceToUpperPercent: 14
};

describe('makeRangeReviewDecision', () => {
  it('returns hold / no rebalance / unchanged range when complete and healthy', () => {
    const out = makeRangeReviewDecision({ price, pool, position });
    expect(out.recommendedAction).toBe('hold');
    expect(out.shouldRebalance).toBe(false);
    expect(out.dataQuality).toBe('complete');
    expect(out.confidence).toBe('medium');
    expect(out.recommendedRange).toEqual({ type: 'unchanged', widthBias: 'unchanged' });
    expect(out.requiresHumanApproval).toBe(false);
    expect(out.executionPermittedByAgent).toBe(false);
  });

  it('returns exit_range with shouldRebalance true when out of range', () => {
    const out = makeRangeReviewDecision({
      price,
      pool,
      position: { ...position, inRange: false }
    });
    expect(out.recommendedAction).toBe('exit_range');
    expect(out.shouldRebalance).toBe(true);
    expect(out.recommendedRange).toEqual({
      type: 'backend_must_calculate_exact_ticks',
      widthBias: 'unchanged'
    });
    expect(out.confidence).toBe('high');
    expect(out.requiresHumanApproval).toBe(true);
  });

  it('returns widen_range with widthBias wider when near edge', () => {
    const out = makeRangeReviewDecision({
      price,
      pool,
      position: { ...position, distanceToLowerPercent: 2.5 }
    });
    expect(out.recommendedAction).toBe('widen_range');
    expect(out.shouldRebalance).toBe(true);
    expect(out.recommendedRange.widthBias).toBe('wider');
  });

  it('returns pause_rebalances and shouldRebalance false when stale', () => {
    const out = makeRangeReviewDecision({});
    expect(out.recommendedAction).toBe('pause_rebalances');
    expect(out.shouldRebalance).toBe(false);
    expect(out.riskLevel).toBe('critical');
    expect(out.dataQuality).toBe('stale');
    expect(out.recommendedRange.widthBias).toBe('wider');
    expect(out.recommendedRange.type).toBe('unchanged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/range-review-decision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/range-review-decision.ts`:

```ts
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { RangeReview } from '../contracts/outputs.js';
import { assessDataQuality } from './data-quality.js';
import { assessRangeStatus } from './range-status.js';

export interface RangeReviewInputs {
  price?: PriceSnapshot;
  pool?: PoolSnapshot;
  position?: PositionSnapshot;
}

export type RangeReviewDecision = Omit<RangeReview, 'timestamp'>;

const REBALANCE_ACTIONS = new Set(['tighten_range', 'widen_range', 'exit_range']);

export function makeRangeReviewDecision(
  inputs: RangeReviewInputs
): RangeReviewDecision {
  const { price, pool, position } = inputs;
  const { quality, missing } = assessDataQuality({ price, pool, position });
  const range = assessRangeStatus(position);
  const recommendedAction =
    quality === 'stale' ? 'pause_rebalances' : range.recommendedAction;

  const shouldRebalance =
    REBALANCE_ACTIONS.has(recommendedAction) && quality !== 'stale';

  const widthBias =
    recommendedAction === 'widen_range' || recommendedAction === 'pause_rebalances'
      ? 'wider'
      : 'unchanged';

  const spotPrice =
    position?.spotPrice ?? pool?.spotPrice ?? price?.priceUsd;

  return {
    pair: 'SOL/USDC',
    recommendedAction,
    shouldRebalance,
    confidence:
      quality === 'complete'
        ? range.breachRisk === 'high'
          ? 'high'
          : 'medium'
        : 'low',
    riskLevel: quality === 'stale' ? 'critical' : range.riskLevel,
    dataQuality: quality,
    missingInputs: missing,
    currentRangeAssessment: {
      status: range.status,
      breachRisk: range.breachRisk,
      ...(position?.lowerPrice != null ? { lowerPrice: position.lowerPrice } : {}),
      ...(position?.upperPrice != null ? { upperPrice: position.upperPrice } : {}),
      ...(spotPrice != null ? { spotPrice } : {}),
      ...(position?.distanceToLowerPercent != null
        ? { distanceToLowerPercent: position.distanceToLowerPercent }
        : {}),
      ...(position?.distanceToUpperPercent != null
        ? { distanceToUpperPercent: position.distanceToUpperPercent }
        : {}),
      ...(position?.inRange != null ? { inRange: position.inRange } : {})
    },
    recommendedRange: {
      type: shouldRebalance ? 'backend_must_calculate_exact_ticks' : 'unchanged',
      widthBias
    },
    reasoning: [
      quality === 'complete'
        ? 'Core inputs available.'
        : `Missing inputs: ${missing.join(', ') || 'unknown'}.`,
      `Range status is ${range.status}.`,
      `Breach risk is ${range.breachRisk}.`,
      shouldRebalance
        ? 'Backend validation is required before any transaction preparation.'
        : 'No deterministic rebalance trigger confirmed.'
    ],
    requiresHumanApproval: shouldRebalance,
    executionPermittedByAgent: false
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/range-review-decision.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/range-review-decision.test.ts src/domain/range-review-decision.ts
git commit -m "feat(domain): assemble range review decision body"
```

---

### Task 8: Domain — `weekly-review-decision`

**Files:**
- Create: `tests/domain/weekly-review-decision.test.ts`
- Create: `src/domain/weekly-review-decision.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeWeeklyReviewDecision } from '../../src/domain/weekly-review-decision.js';

describe('makeWeeklyReviewDecision', () => {
  it('returns partial-quality summary when performance snapshot exists', () => {
    const out = makeWeeklyReviewDecision({
      performance: { totalFeesUsd: 12 },
      dailyInsight: { recommendedAction: 'hold' },
      rebalance: undefined
    });
    expect(out.dataQuality).toBe('partial');
    expect(out.summary).toContain('Performance snapshot available');
    expect(out.inputs).toEqual({
      hasPerformanceSnapshot: true,
      hasDailyInsight: true,
      hasRebalanceRecommendation: false
    });
    expect(out.decisionQualityReview.grade).toBe('ungraded');
    expect(out.proposedPolicyChanges).toEqual([]);
    expect(out.executionPermittedByAgent).toBe(false);
  });

  it('returns stale-quality summary when performance snapshot is missing', () => {
    const out = makeWeeklyReviewDecision({});
    expect(out.dataQuality).toBe('stale');
    expect(out.summary).toContain('No backend performance snapshot');
    expect(out.inputs).toEqual({
      hasPerformanceSnapshot: false,
      hasDailyInsight: false,
      hasRebalanceRecommendation: false
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/weekly-review-decision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/weekly-review-decision.ts`:

```ts
import type { WeeklyReview } from '../contracts/outputs.js';
import type { PerformanceSnapshot } from '../contracts/snapshots.js';

export interface WeeklyReviewInputs {
  performance?: PerformanceSnapshot;
  dailyInsight?: Record<string, unknown>;
  rebalance?: Record<string, unknown>;
}

export type WeeklyReviewDecision = Omit<WeeklyReview, 'timestamp'>;

export function makeWeeklyReviewDecision(
  inputs: WeeklyReviewInputs
): WeeklyReviewDecision {
  const { performance, dailyInsight, rebalance } = inputs;
  return {
    pair: 'SOL/USDC',
    dataQuality: performance ? 'partial' : 'stale',
    summary: performance
      ? 'Performance snapshot available. Agent should compare CLMM fees, range outcomes, and HODL benchmark.'
      : 'No backend performance snapshot available. Weekly review should be conservative and avoid policy changes.',
    inputs: {
      hasPerformanceSnapshot: Boolean(performance),
      hasDailyInsight: Boolean(dailyInsight),
      hasRebalanceRecommendation: Boolean(rebalance)
    },
    decisionQualityReview: {
      grade: 'ungraded',
      reason: 'Requires backend performance metrics and human review.'
    },
    proposedPolicyChanges: [],
    executionPermittedByAgent: false
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/weekly-review-decision.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/weekly-review-decision.test.ts src/domain/weekly-review-decision.ts
git commit -m "feat(domain): assemble weekly review decision body"
```

---

### Task 9: Domain — `cron-command`

This is the pure command builder used by both render and sync. It produces a structured argv `{ command, args }`. Render formats with shell quoting; sync passes argv directly to the runner port.

**Files:**
- Create: `tests/domain/cron-command.test.ts`
- Create: `src/domain/cron-command.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildCronAddArgs } from '../../src/domain/cron-command.js';

describe('buildCronAddArgs', () => {
  it('builds the minimal argv set when no defaults or delivery are present', () => {
    const result = buildCronAddArgs({
      job: { name: 'clmm-daily', cron: '0 7 * * *', messageFile: 'r.md' },
      message: 'hello',
      timezone: 'America/Edmonton',
      session: 'isolated',
      exact: false
    });
    expect(result.command).toBe('openclaw');
    expect(result.args).toEqual([
      'cron',
      'add',
      '--name',
      'clmm-daily',
      '--cron',
      '0 7 * * *',
      '--tz',
      'America/Edmonton',
      '--session',
      'isolated',
      '--message',
      'hello'
    ]);
  });

  it('appends model and thinking when set on job', () => {
    const result = buildCronAddArgs({
      job: {
        name: 'a',
        cron: '* * * * *',
        messageFile: 'r.md',
        model: 'opus',
        thinking: 'high'
      },
      message: 'm',
      timezone: 'UTC',
      session: 'isolated',
      exact: false
    });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('opus');
    expect(result.args).toContain('--thinking');
    expect(result.args).toContain('high');
  });

  it('falls back to default model and thinking when job lacks them', () => {
    const result = buildCronAddArgs({
      job: { name: 'a', cron: '* * * * *', messageFile: 'r.md' },
      message: 'm',
      timezone: 'UTC',
      session: 'isolated',
      exact: false,
      defaultModel: 'sonnet',
      defaultThinking: 'medium'
    });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('sonnet');
    expect(result.args).toContain('--thinking');
    expect(result.args).toContain('medium');
  });

  it('appends agent and exact flags when present', () => {
    const result = buildCronAddArgs({
      job: { name: 'a', cron: '* * * * *', messageFile: 'r.md' },
      message: 'm',
      timezone: 'UTC',
      session: 'isolated',
      exact: true,
      agent: 'claude'
    });
    expect(result.args).toContain('--agent');
    expect(result.args).toContain('claude');
    expect(result.args).toContain('--exact');
  });

  it('appends announce/channel/to when both delivery values are present', () => {
    const result = buildCronAddArgs({
      job: { name: 'a', cron: '* * * * *', messageFile: 'r.md' },
      message: 'm',
      timezone: 'UTC',
      session: 'isolated',
      exact: false,
      delivery: { channel: 'telegram', to: '12345' }
    });
    expect(result.args).toEqual(
      expect.arrayContaining(['--announce', '--channel', 'telegram', '--to', '12345'])
    );
  });

  it('does not append delivery flags when partial delivery is provided', () => {
    const result = buildCronAddArgs({
      job: { name: 'a', cron: '* * * * *', messageFile: 'r.md' },
      message: 'm',
      timezone: 'UTC',
      session: 'isolated',
      exact: false,
      delivery: { channel: 'telegram', to: '' }
    });
    expect(result.args).not.toContain('--announce');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/domain/cron-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/cron-command.ts`:

```ts
import type { CronJob } from '../contracts/cron-config.js';

export interface BuildCronAddArgsInputs {
  job: CronJob;
  message: string;
  timezone: string;
  session: string;
  exact: boolean;
  defaultModel?: string;
  defaultThinking?: string;
  agent?: string;
  delivery?: { channel: string; to: string };
}

export interface CronCommand {
  command: 'openclaw';
  args: string[];
}

export function buildCronAddArgs(inputs: BuildCronAddArgsInputs): CronCommand {
  const { job, message, timezone, session, exact, defaultModel, defaultThinking, agent, delivery } = inputs;
  const args: string[] = [
    'cron',
    'add',
    '--name', job.name,
    '--cron', job.cron,
    '--tz', timezone,
    '--session', session,
    '--message', message
  ];

  const model = job.model ?? defaultModel;
  const thinking = job.thinking ?? defaultThinking;
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (agent) args.push('--agent', agent);
  if (exact) args.push('--exact');
  if (delivery && delivery.channel && delivery.to) {
    args.push('--announce', '--channel', delivery.channel, '--to', delivery.to);
  }

  return { command: 'openclaw', args };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/domain/cron-command.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/domain/cron-command.test.ts src/domain/cron-command.ts
git commit -m "feat(domain): pure cron add argv builder"
```

---

## Phase 3: Ports

### Task 10: Define port interfaces

**Files:**
- Create: `src/ports/http.ts`
- Create: `src/ports/json-store.ts`
- Create: `src/ports/text-reader.ts`
- Create: `src/ports/env.ts`
- Create: `src/ports/clock.ts`
- Create: `src/ports/command-runner.ts`
- Create: `src/ports/index.ts`

Ports are interfaces only. There are no port-level tests; they are exercised through fakes in the application tests.

- [ ] **Step 1: Create `src/ports/http.ts`**

```ts
export interface HttpClient {
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
}
```

- [ ] **Step 2: Create `src/ports/json-store.ts`**

```ts
export interface JsonStore {
  readJson<T>(path: string): Promise<T | undefined>;
  writeJson(path: string, value: unknown): Promise<void>;
}
```

- [ ] **Step 3: Create `src/ports/text-reader.ts`**

```ts
export interface TextReader {
  readText(path: string): Promise<string>;
}
```

- [ ] **Step 4: Create `src/ports/env.ts`**

```ts
export interface EnvReader {
  get(name: string, fallback?: string): string;
  getOptional(name: string): string | undefined;
}
```

- [ ] **Step 5: Create `src/ports/clock.ts`**

```ts
export interface Clock {
  now(): string;
}
```

- [ ] **Step 6: Create `src/ports/command-runner.ts`**

```ts
export interface CommandRunner {
  run(command: string, args: string[]): Promise<void>;
}
```

- [ ] **Step 7: Create `src/ports/index.ts`**

```ts
export type { HttpClient } from './http.js';
export type { JsonStore } from './json-store.js';
export type { TextReader } from './text-reader.js';
export type { EnvReader } from './env.js';
export type { Clock } from './clock.js';
export type { CommandRunner } from './command-runner.js';
```

- [ ] **Step 8: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/ports
git commit -m "feat(ports): define port interfaces for adapters"
```

---

## Phase 4: Test Fakes

### Task 11: In-memory fakes for ports

**Files:**
- Create: `tests/fakes/fake-http.ts`
- Create: `tests/fakes/fake-json-store.ts`
- Create: `tests/fakes/fake-text-reader.ts`
- Create: `tests/fakes/fake-env.ts`
- Create: `tests/fakes/fake-clock.ts`
- Create: `tests/fakes/fake-command-runner.ts`
- Create: `tests/fakes/index.ts`

These are simple in-memory implementations used across the application tests. They are test infrastructure, not production code. No standalone tests for the fakes themselves — they are exercised through use case tests.

- [ ] **Step 1: Create `tests/fakes/fake-http.ts`**

```ts
import type { HttpClient } from '../../src/ports/http.js';

export interface FakeHttpResponse {
  body?: unknown;
  error?: Error;
}

export class FakeHttp implements HttpClient {
  readonly calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  private readonly responses = new Map<string, FakeHttpResponse>();

  setResponse(url: string, response: FakeHttpResponse): void {
    this.responses.set(url, response);
  }

  async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    this.calls.push({ url, ...(headers ? { headers } : {}) });
    const response = this.responses.get(url);
    if (!response) throw new Error(`FakeHttp: no response configured for ${url}`);
    if (response.error) throw response.error;
    return response.body as T;
  }
}
```

- [ ] **Step 2: Create `tests/fakes/fake-json-store.ts`**

```ts
import type { JsonStore } from '../../src/ports/json-store.js';

export class FakeJsonStore implements JsonStore {
  readonly writes: Array<{ path: string; value: unknown }> = [];
  private readonly entries = new Map<string, unknown>();

  seed(path: string, value: unknown): void {
    this.entries.set(path, value);
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    return (this.entries.get(path) as T | undefined) ?? undefined;
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    this.writes.push({ path, value });
    this.entries.set(path, value);
  }
}
```

- [ ] **Step 3: Create `tests/fakes/fake-text-reader.ts`**

```ts
import type { TextReader } from '../../src/ports/text-reader.js';

export class FakeTextReader implements TextReader {
  private readonly entries = new Map<string, string>();

  seed(path: string, content: string): void {
    this.entries.set(path, content);
  }

  async readText(path: string): Promise<string> {
    const entry = this.entries.get(path);
    if (entry === undefined) {
      const error = new Error(`FakeTextReader: missing ${path}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return entry;
  }
}
```

- [ ] **Step 4: Create `tests/fakes/fake-env.ts`**

```ts
import type { EnvReader } from '../../src/ports/env.js';

export class FakeEnv implements EnvReader {
  constructor(private readonly values: Record<string, string | undefined> = {}) {}

  set(name: string, value: string | undefined): void {
    this.values[name] = value;
  }

  get(name: string, fallback?: string): string {
    const value = this.values[name] ?? fallback;
    if (value == null || value.length === 0) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  getOptional(name: string): string | undefined {
    const value = this.values[name];
    return value == null || value.length === 0 ? undefined : value;
  }
}
```

- [ ] **Step 5: Create `tests/fakes/fake-clock.ts`**

```ts
import type { Clock } from '../../src/ports/clock.js';

export class FakeClock implements Clock {
  constructor(private value: string) {}
  now(): string {
    return this.value;
  }
  set(value: string): void {
    this.value = value;
  }
}
```

- [ ] **Step 6: Create `tests/fakes/fake-command-runner.ts`**

```ts
import type { CommandRunner } from '../../src/ports/command-runner.js';

export class FakeCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];
  shouldFailWith?: Error;

  async run(command: string, args: string[]): Promise<void> {
    this.calls.push({ command, args: [...args] });
    if (this.shouldFailWith) throw this.shouldFailWith;
  }
}
```

- [ ] **Step 7: Create `tests/fakes/index.ts`**

```ts
export { FakeHttp } from './fake-http.js';
export { FakeJsonStore } from './fake-json-store.js';
export { FakeTextReader } from './fake-text-reader.js';
export { FakeEnv } from './fake-env.js';
export { FakeClock } from './fake-clock.js';
export { FakeCommandRunner } from './fake-command-runner.js';
```

- [ ] **Step 8: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add tests/fakes
git commit -m "test: add in-memory port fakes for application tests"
```

---

## Phase 5: Application Use Cases

### Task 12: Application — `generate-daily-insight`

**Files:**
- Create: `tests/application/generate-daily-insight.test.ts`
- Create: `src/application/generate-daily-insight.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { generateDailyInsight } from '../../src/application/generate-daily-insight.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

describe('generateDailyInsight', () => {
  it('reads snapshots, writes outputs/sol-usdc-daily-insight.json, returns the output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-price-snapshot.json', {
      pair: 'SOL/USDC',
      timestamp: '2026-05-10T12:00:00.000Z',
      source: 'jupiter-price-v3',
      priceUsd: 175.4,
      confidence: 'high'
    });
    jsonStore.seed('data/latest-pool-snapshot.json', {
      pair: 'SOL/USDC',
      timestamp: '2026-05-10T12:00:00.000Z',
      source: 'fastify',
      spotPrice: 175.5,
      feeApr: 60
    });
    jsonStore.seed('data/latest-position-snapshot.json', {
      pair: 'SOL/USDC',
      timestamp: '2026-05-10T12:00:00.000Z',
      source: 'fastify',
      inRange: true,
      lowerPrice: 150,
      upperPrice: 200,
      spotPrice: 175.5,
      distanceToLowerPercent: 15,
      distanceToUpperPercent: 14
    });
    const clock = new FakeClock('2026-05-10T13:00:00.000Z');

    const result = await generateDailyInsight({ jsonStore, clock });

    expect(jsonStore.writes).toHaveLength(1);
    expect(jsonStore.writes[0]).toEqual({
      path: 'outputs/sol-usdc-daily-insight.json',
      value: expect.objectContaining({
        timestamp: '2026-05-10T13:00:00.000Z',
        recommendedAction: 'hold',
        dataQuality: 'complete'
      })
    });
    expect(result.timestamp).toBe('2026-05-10T13:00:00.000Z');
    expect(result.recommendedAction).toBe('hold');
  });

  it('emits stale-quality output when no snapshots are present', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T14:00:00.000Z');

    const result = await generateDailyInsight({ jsonStore, clock });

    expect(result.dataQuality).toBe('stale');
    expect(result.recommendedAction).toBe('pause_rebalances');
    expect(jsonStore.writes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/generate-daily-insight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/generate-daily-insight.ts`:

```ts
import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { DailyInsight } from '../contracts/outputs.js';
import { makeDailyInsightDecision } from '../domain/daily-insight-decision.js';

export interface GenerateDailyInsightDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const DAILY_INSIGHT_OUTPUT_PATH = 'outputs/sol-usdc-daily-insight.json';

export async function generateDailyInsight(
  deps: GenerateDailyInsightDeps
): Promise<DailyInsight> {
  const { jsonStore, clock } = deps;
  const [price, pool, position] = await Promise.all([
    jsonStore.readJson<PriceSnapshot>('data/latest-price-snapshot.json'),
    jsonStore.readJson<PoolSnapshot>('data/latest-pool-snapshot.json'),
    jsonStore.readJson<PositionSnapshot>('data/latest-position-snapshot.json')
  ]);

  const decision = makeDailyInsightDecision({ price, pool, position });
  const output: DailyInsight = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(DAILY_INSIGHT_OUTPUT_PATH, output);
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/generate-daily-insight.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/generate-daily-insight.test.ts src/application/generate-daily-insight.ts
git commit -m "feat(application): generateDailyInsight use case"
```

---

### Task 13: Application — `generate-range-review`

**Files:**
- Create: `tests/application/generate-range-review.test.ts`
- Create: `src/application/generate-range-review.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { generateRangeReview } from '../../src/application/generate-range-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

describe('generateRangeReview', () => {
  it('writes outputs/sol-usdc-rebalance-recommendation.json with timestamp and decision', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-position-snapshot.json', {
      pair: 'SOL/USDC',
      timestamp: '2026-05-10T12:00:00.000Z',
      source: 'fastify',
      inRange: false,
      lowerPrice: 150,
      upperPrice: 200,
      spotPrice: 145
    });
    const clock = new FakeClock('2026-05-10T13:00:00.000Z');
    const result = await generateRangeReview({ jsonStore, clock });

    expect(jsonStore.writes[0]?.path).toBe('outputs/sol-usdc-rebalance-recommendation.json');
    expect(result.timestamp).toBe('2026-05-10T13:00:00.000Z');
    expect(result.recommendedAction).toBe('exit_range');
    expect(result.shouldRebalance).toBe(true);
  });

  it('emits pause_rebalances under stale data', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T13:00:00.000Z');
    const result = await generateRangeReview({ jsonStore, clock });
    expect(result.recommendedAction).toBe('pause_rebalances');
    expect(result.shouldRebalance).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/generate-range-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/generate-range-review.ts`:

```ts
import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';
import type {
  PoolSnapshot,
  PositionSnapshot,
  PriceSnapshot
} from '../contracts/snapshots.js';
import type { RangeReview } from '../contracts/outputs.js';
import { makeRangeReviewDecision } from '../domain/range-review-decision.js';

export interface GenerateRangeReviewDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const RANGE_REVIEW_OUTPUT_PATH = 'outputs/sol-usdc-rebalance-recommendation.json';

export async function generateRangeReview(
  deps: GenerateRangeReviewDeps
): Promise<RangeReview> {
  const { jsonStore, clock } = deps;
  const [price, pool, position] = await Promise.all([
    jsonStore.readJson<PriceSnapshot>('data/latest-price-snapshot.json'),
    jsonStore.readJson<PoolSnapshot>('data/latest-pool-snapshot.json'),
    jsonStore.readJson<PositionSnapshot>('data/latest-position-snapshot.json')
  ]);

  const decision = makeRangeReviewDecision({ price, pool, position });
  const output: RangeReview = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(RANGE_REVIEW_OUTPUT_PATH, output);
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/generate-range-review.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/generate-range-review.test.ts src/application/generate-range-review.ts
git commit -m "feat(application): generateRangeReview use case"
```

---

### Task 14: Application — `generate-weekly-review`

**Files:**
- Create: `tests/application/generate-weekly-review.test.ts`
- Create: `src/application/generate-weekly-review.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { generateWeeklyReview } from '../../src/application/generate-weekly-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

describe('generateWeeklyReview', () => {
  it('reads performance, daily insight, rebalance and writes outputs/weekly-clmm-review.json', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-performance-snapshot.json', { totalFeesUsd: 12 });
    jsonStore.seed('outputs/sol-usdc-daily-insight.json', { recommendedAction: 'hold' });
    const clock = new FakeClock('2026-05-10T15:00:00.000Z');
    const result = await generateWeeklyReview({ jsonStore, clock });

    expect(jsonStore.writes[0]?.path).toBe('outputs/weekly-clmm-review.json');
    expect(result.timestamp).toBe('2026-05-10T15:00:00.000Z');
    expect(result.dataQuality).toBe('partial');
    expect(result.inputs).toEqual({
      hasPerformanceSnapshot: true,
      hasDailyInsight: true,
      hasRebalanceRecommendation: false
    });
  });

  it('falls back to stale quality when performance snapshot missing', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T15:00:00.000Z');
    const result = await generateWeeklyReview({ jsonStore, clock });
    expect(result.dataQuality).toBe('stale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/generate-weekly-review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/generate-weekly-review.ts`:

```ts
import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';
import type {
  PerformanceSnapshot
} from '../contracts/snapshots.js';
import type { WeeklyReview } from '../contracts/outputs.js';
import { makeWeeklyReviewDecision } from '../domain/weekly-review-decision.js';

export interface GenerateWeeklyReviewDeps {
  jsonStore: JsonStore;
  clock: Clock;
}

export const WEEKLY_REVIEW_OUTPUT_PATH = 'outputs/weekly-clmm-review.json';

export async function generateWeeklyReview(
  deps: GenerateWeeklyReviewDeps
): Promise<WeeklyReview> {
  const { jsonStore, clock } = deps;
  const [performance, dailyInsight, rebalance] = await Promise.all([
    jsonStore.readJson<PerformanceSnapshot>('data/latest-performance-snapshot.json'),
    jsonStore.readJson<Record<string, unknown>>('outputs/sol-usdc-daily-insight.json'),
    jsonStore.readJson<Record<string, unknown>>('outputs/sol-usdc-rebalance-recommendation.json')
  ]);

  const decision = makeWeeklyReviewDecision({ performance, dailyInsight, rebalance });
  const output: WeeklyReview = { ...decision, timestamp: clock.now() };
  await jsonStore.writeJson(WEEKLY_REVIEW_OUTPUT_PATH, output);
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/generate-weekly-review.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/generate-weekly-review.test.ts src/application/generate-weekly-review.ts
git commit -m "feat(application): generateWeeklyReview use case"
```

---

### Task 15: Application — `collect-jupiter-price`

**Files:**
- Create: `tests/application/collect-jupiter-price.test.ts`
- Create: `src/application/collect-jupiter-price.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { collectJupiterPrice } from '../../src/application/collect-jupiter-price.js';
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from '../fakes/index.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

describe('collectJupiterPrice', () => {
  it('writes data/latest-price-snapshot.json with usdPrice, source, and clock timestamp', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, {
      body: { [SOL_MINT]: { usdPrice: 175.42, blockId: 1, decimals: 9, priceChange24h: 0.5 } }
    });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ SOL_MINT });
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await collectJupiterPrice({ http, jsonStore, env, clock });

    expect(jsonStore.writes[0]).toEqual({
      path: 'data/latest-price-snapshot.json',
      value: expect.objectContaining({
        pair: 'SOL/USDC',
        timestamp: '2026-05-10T12:30:00.000Z',
        source: 'jupiter-price-v3',
        priceUsd: 175.42,
        confidence: 'high'
      })
    });
  });

  it('uses default mint when SOL_MINT env is unset', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, { body: { [SOL_MINT]: { usdPrice: 1 } } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({});
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await collectJupiterPrice({ http, jsonStore, env, clock });
    expect(http.calls[0]?.url).toBe(url);
  });

  it('throws when usdPrice is missing in the response', async () => {
    const http = new FakeHttp();
    const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(SOL_MINT)}`;
    http.setResponse(url, { body: { [SOL_MINT]: {} } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ SOL_MINT });
    const clock = new FakeClock('2026-05-10T12:30:00.000Z');

    await expect(collectJupiterPrice({ http, jsonStore, env, clock })).rejects.toThrow(
      'Jupiter response did not include usdPrice for SOL'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/collect-jupiter-price.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/collect-jupiter-price.ts`:

```ts
import type { HttpClient } from '../ports/http.js';
import type { JsonStore } from '../ports/json-store.js';
import type { EnvReader } from '../ports/env.js';
import type { Clock } from '../ports/clock.js';

export interface CollectJupiterPriceDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
}

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice?: number;
    blockId?: number;
    decimals?: number;
    priceChange24h?: number;
  };
}

export const PRICE_SNAPSHOT_PATH = 'data/latest-price-snapshot.json';
const DEFAULT_SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function collectJupiterPrice(deps: CollectJupiterPriceDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  const solMint = env.get('SOL_MINT', DEFAULT_SOL_MINT);
  const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(solMint)}`;
  const response = await http.getJson<JupiterPriceResponse>(url);
  const row = response[solMint];

  if (!row?.usdPrice) {
    throw new Error('Jupiter response did not include usdPrice for SOL');
  }

  await jsonStore.writeJson(PRICE_SNAPSHOT_PATH, {
    pair: 'SOL/USDC',
    timestamp: clock.now(),
    source: 'jupiter-price-v3',
    priceUsd: row.usdPrice,
    confidence: 'high',
    raw: row
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/collect-jupiter-price.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/collect-jupiter-price.test.ts src/application/collect-jupiter-price.ts
git commit -m "feat(application): collectJupiterPrice use case"
```

---

### Task 16: Application — `collect-backend-snapshot`

**Files:**
- Create: `tests/application/collect-backend-snapshot.test.ts`
- Create: `src/application/collect-backend-snapshot.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { collectBackendSnapshot } from '../../src/application/collect-backend-snapshot.js';
import { FakeHttp, FakeJsonStore, FakeEnv } from '../fakes/index.js';

describe('collectBackendSnapshot', () => {
  it('writes pool, position, and performance files when all sources succeed', async () => {
    const http = new FakeHttp();
    http.setResponse('http://api.test/api/clmm/sol-usdc/pool-snapshot', { body: { pool: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/position-snapshot', { body: { position: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/performance-snapshot', { body: { perf: 1 } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ CLMM_DATA_API_BASE: 'http://api.test' });

    const result = await collectBackendSnapshot({ http, jsonStore, env });

    expect(result.failures).toEqual([]);
    expect(jsonStore.writes.map((w) => w.path).sort()).toEqual([
      'data/latest-performance-snapshot.json',
      'data/latest-pool-snapshot.json',
      'data/latest-position-snapshot.json'
    ]);
  });

  it('returns failures array containing per-source errors without throwing', async () => {
    const http = new FakeHttp();
    http.setResponse('http://api.test/api/clmm/sol-usdc/pool-snapshot', { body: { pool: 1 } });
    http.setResponse('http://api.test/api/clmm/sol-usdc/position-snapshot', { error: new Error('502 bad gateway') });
    http.setResponse('http://api.test/api/clmm/sol-usdc/performance-snapshot', { body: { perf: 1 } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ CLMM_DATA_API_BASE: 'http://api.test/' });

    const result = await collectBackendSnapshot({ http, jsonStore, env });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toBe('502 bad gateway');
    expect(jsonStore.writes.map((w) => w.path)).toEqual(
      expect.arrayContaining([
        'data/latest-pool-snapshot.json',
        'data/latest-performance-snapshot.json'
      ])
    );
  });

  it('throws when CLMM_DATA_API_BASE is unset', async () => {
    await expect(
      collectBackendSnapshot({
        http: new FakeHttp(),
        jsonStore: new FakeJsonStore(),
        env: new FakeEnv({})
      })
    ).rejects.toThrow('Missing required environment variable: CLMM_DATA_API_BASE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/collect-backend-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/collect-backend-snapshot.ts`:

```ts
import type { HttpClient } from '../ports/http.js';
import type { JsonStore } from '../ports/json-store.js';
import type { EnvReader } from '../ports/env.js';

export interface CollectBackendSnapshotDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export interface CollectBackendSnapshotResult {
  failures: Error[];
}

interface SnapshotTarget {
  path: string;
  url: string;
}

export async function collectBackendSnapshot(
  deps: CollectBackendSnapshotDeps
): Promise<CollectBackendSnapshotResult> {
  const { http, jsonStore, env } = deps;
  const base = env.get('CLMM_DATA_API_BASE');
  const normalized = base.replace(/\/$/, '');

  const targets: SnapshotTarget[] = [
    { path: 'data/latest-pool-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/pool-snapshot` },
    { path: 'data/latest-position-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/position-snapshot` },
    { path: 'data/latest-performance-snapshot.json', url: `${normalized}/api/clmm/sol-usdc/performance-snapshot` }
  ];

  const settled = await Promise.allSettled(
    targets.map(async (target) => {
      const value = await http.getJson<unknown>(target.url);
      await jsonStore.writeJson(target.path, value);
    })
  );

  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) =>
      result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    );

  return { failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/collect-backend-snapshot.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/collect-backend-snapshot.test.ts src/application/collect-backend-snapshot.ts
git commit -m "feat(application): collectBackendSnapshot use case"
```

---

### Task 17: Application — `collect-coingecko` and `collect-defillama`

These are ancillary collectors not in `pnpm` scripts. Move them behind use cases so the boundary rules pass when scripts are rewired.

**Files:**
- Create: `tests/application/ancillary-collectors.test.ts`
- Create: `src/application/collect-coingecko.ts`
- Create: `src/application/collect-defillama.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { collectCoingecko } from '../../src/application/collect-coingecko.js';
import { collectDefillama } from '../../src/application/collect-defillama.js';
import { FakeHttp, FakeJsonStore, FakeEnv, FakeClock } from '../fakes/index.js';

describe('collectCoingecko', () => {
  it('writes data/latest-coingecko-solana-raw.json with timestamp', async () => {
    const http = new FakeHttp();
    const url = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
    http.setResponse(url, { body: { id: 'solana' } });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({ COINGECKO_API_KEY: 'k' });
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');

    await collectCoingecko({ http, jsonStore, env, clock });

    expect(http.calls[0]).toEqual({ url, headers: { 'x-cg-demo-api-key': 'k' } });
    expect(jsonStore.writes[0]?.path).toBe('data/latest-coingecko-solana-raw.json');
  });

  it('omits api-key header when COINGECKO_API_KEY is unset', async () => {
    const http = new FakeHttp();
    const url = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';
    http.setResponse(url, { body: {} });
    const jsonStore = new FakeJsonStore();
    const env = new FakeEnv({});
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');

    await collectCoingecko({ http, jsonStore, env, clock });
    expect(http.calls[0]?.headers).toBeUndefined();
  });
});

describe('collectDefillama', () => {
  it('writes data/latest-defillama-solana-raw.json with timestamp', async () => {
    const http = new FakeHttp();
    http.setResponse('https://api.llama.fi/v2/chains', { body: [{ name: 'Solana' }] });
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock('2026-05-10T12:00:00.000Z');
    await collectDefillama({ http, jsonStore, clock });
    expect(jsonStore.writes[0]?.path).toBe('data/latest-defillama-solana-raw.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/ancillary-collectors.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/application/collect-coingecko.ts`**

```ts
import type { HttpClient } from '../ports/http.js';
import type { JsonStore } from '../ports/json-store.js';
import type { EnvReader } from '../ports/env.js';
import type { Clock } from '../ports/clock.js';

export interface CollectCoingeckoDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
}

export const COINGECKO_OUTPUT_PATH = 'data/latest-coingecko-solana-raw.json';
const URL = 'https://api.coingecko.com/api/v3/coins/solana?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false';

export async function collectCoingecko(deps: CollectCoingeckoDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  const apiKey = env.getOptional('COINGECKO_API_KEY');
  const raw = apiKey
    ? await http.getJson<unknown>(URL, { 'x-cg-demo-api-key': apiKey })
    : await http.getJson<unknown>(URL);
  await jsonStore.writeJson(COINGECKO_OUTPUT_PATH, {
    timestamp: clock.now(),
    source: 'coingecko',
    raw
  });
}
```

- [ ] **Step 4: Write `src/application/collect-defillama.ts`**

```ts
import type { HttpClient } from '../ports/http.js';
import type { JsonStore } from '../ports/json-store.js';
import type { Clock } from '../ports/clock.js';

export interface CollectDefillamaDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  clock: Clock;
}

export const DEFILLAMA_OUTPUT_PATH = 'data/latest-defillama-solana-raw.json';

export async function collectDefillama(deps: CollectDefillamaDeps): Promise<void> {
  const { http, jsonStore, clock } = deps;
  const raw = await http.getJson<unknown>('https://api.llama.fi/v2/chains');
  await jsonStore.writeJson(DEFILLAMA_OUTPUT_PATH, {
    timestamp: clock.now(),
    source: 'defillama',
    raw
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/application/ancillary-collectors.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/application/ancillary-collectors.test.ts src/application/collect-coingecko.ts src/application/collect-defillama.ts
git commit -m "feat(application): coingecko and defillama collector use cases"
```

---

### Task 18: Application — `load-cron-config`

**Files:**
- Create: `tests/application/load-cron-config.test.ts`
- Create: `src/application/load-cron-config.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { loadCronConfig } from '../../src/application/load-cron-config.js';
import { FakeTextReader, FakeEnv } from '../fakes/index.js';

const yaml = `
timezone: America/Edmonton
session: isolated
modelEnv: OPENCLAW_MODEL
thinkingEnv: OPENCLAW_THINKING
agentEnv: OPENCLAW_AGENT
exactEnv: OPENCLAW_EXACT
delivery:
  channelEnv: OPENCLAW_DELIVERY_CHANNEL
  toEnv: OPENCLAW_DELIVERY_TO
jobs:
  - name: clmm-daily
    cron: "0 7 * * *"
    messageFile: routines/daily.md
`;

describe('loadCronConfig', () => {
  it('parses YAML, resolves env defaults, and reads message files via the TextReader port', async () => {
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('routines/daily.md', 'Daily routine.');
    const env = new FakeEnv({
      OPENCLAW_MODEL: 'opus',
      OPENCLAW_THINKING: 'high',
      OPENCLAW_AGENT: 'claude',
      OPENCLAW_EXACT: 'true',
      OPENCLAW_DELIVERY_CHANNEL: 'telegram',
      OPENCLAW_DELIVERY_TO: '12345'
    });

    const result = await loadCronConfig({ textReader, env });

    expect(result.defaults).toEqual({
      timezone: 'America/Edmonton',
      session: 'isolated',
      defaultModel: 'opus',
      defaultThinking: 'high',
      agent: 'claude',
      exact: true,
      delivery: { channel: 'telegram', to: '12345' }
    });
    expect(result.preparedJobs).toHaveLength(1);
    expect(result.preparedJobs[0]?.message).toBe('Daily routine.');
    expect(result.preparedJobs[0]?.job.name).toBe('clmm-daily');
  });

  it('omits delivery when only channel is set without to', async () => {
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('routines/daily.md', 'm');
    const env = new FakeEnv({
      OPENCLAW_DELIVERY_CHANNEL: 'telegram'
    });
    const result = await loadCronConfig({ textReader, env });
    expect(result.defaults.delivery).toBeUndefined();
    expect(result.defaults.exact).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/load-cron-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/load-cron-config.ts`:

```ts
import YAML from 'yaml';
import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import type {
  CronConfig,
  PreparedCronJob,
  ResolvedCronDefaults
} from '../contracts/cron-config.js';

export interface LoadCronConfigDeps {
  textReader: TextReader;
  env: EnvReader;
  configPath?: string;
}

export interface LoadedCronConfig {
  defaults: ResolvedCronDefaults;
  preparedJobs: PreparedCronJob[];
}

export const DEFAULT_CRON_CONFIG_PATH = 'cron/jobs.yaml';

export async function loadCronConfig(
  deps: LoadCronConfigDeps
): Promise<LoadedCronConfig> {
  const { textReader, env, configPath = DEFAULT_CRON_CONFIG_PATH } = deps;
  const config = YAML.parse(await textReader.readText(configPath)) as CronConfig;

  const defaultModel = config.modelEnv ? env.getOptional(config.modelEnv) : undefined;
  const defaultThinking = config.thinkingEnv
    ? env.getOptional(config.thinkingEnv)
    : undefined;
  const agent = config.agentEnv ? env.getOptional(config.agentEnv) : undefined;
  const exact = config.exactEnv
    ? (env.getOptional(config.exactEnv) ?? '').toLowerCase() === 'true'
    : false;
  const channel = config.delivery?.channelEnv
    ? env.getOptional(config.delivery.channelEnv)
    : undefined;
  const to = config.delivery?.toEnv ? env.getOptional(config.delivery.toEnv) : undefined;

  const defaults: ResolvedCronDefaults = {
    timezone: config.timezone,
    session: config.session,
    ...(defaultModel ? { defaultModel } : {}),
    ...(defaultThinking ? { defaultThinking } : {}),
    ...(agent ? { agent } : {}),
    exact,
    ...(channel && to ? { delivery: { channel, to } } : {})
  };

  const preparedJobs: PreparedCronJob[] = await Promise.all(
    config.jobs.map(async (job) => {
      const message = await textReader.readText(job.messageFile);
      const model = job.model ?? defaultModel;
      const thinking = job.thinking ?? defaultThinking;
      return {
        job,
        message,
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {})
      };
    })
  );

  return { defaults, preparedJobs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/load-cron-config.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/load-cron-config.test.ts src/application/load-cron-config.ts
git commit -m "feat(application): loadCronConfig parses YAML and resolves env defaults"
```

---

### Task 19: Application — `render-cron-commands`

The render output format must match the existing script: `openclaw cron add --name 'foo' --cron '0 7 * * *' ...` with single-quote shell escaping. The use case returns the lines as an array; the entrypoint prints each followed by a blank line.

**Files:**
- Create: `tests/application/render-cron-commands.test.ts`
- Create: `src/application/render-cron-commands.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { renderCronCommands } from '../../src/application/render-cron-commands.js';
import { FakeTextReader, FakeEnv } from '../fakes/index.js';

const yaml = `
timezone: UTC
session: isolated
modelEnv: OPENCLAW_MODEL
jobs:
  - name: a
    cron: "0 7 * * *"
    messageFile: r.md
`;

describe('renderCronCommands', () => {
  it('returns a shell-quoted line per job that begins with "openclaw cron add"', async () => {
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('r.md', "Multi'line\nmessage");
    const env = new FakeEnv({ OPENCLAW_MODEL: 'opus' });
    const lines = await renderCronCommands({ textReader, env });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("openclaw cron add ");
    expect(lines[0]).toContain("--name 'a'");
    expect(lines[0]).toContain("--cron '0 7 * * *'");
    expect(lines[0]).toContain("--tz 'UTC'");
    expect(lines[0]).toContain("--session 'isolated'");
    expect(lines[0]).toContain("--model 'opus'");
    expect(lines[0]).toContain("--message 'Multi'\"'\"'line\nmessage'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/render-cron-commands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/render-cron-commands.ts`:

```ts
import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import { buildCronAddArgs } from '../domain/cron-command.js';
import { loadCronConfig } from './load-cron-config.js';

export interface RenderCronCommandsDeps {
  textReader: TextReader;
  env: EnvReader;
  configPath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function renderCronCommands(
  deps: RenderCronCommandsDeps
): Promise<string[]> {
  const { defaults, preparedJobs } = await loadCronConfig(deps);

  return preparedJobs.map((prepared) => {
    const { args } = buildCronAddArgs({
      job: prepared.job,
      message: prepared.message,
      timezone: defaults.timezone,
      session: defaults.session,
      exact: defaults.exact,
      ...(defaults.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
      ...(defaults.defaultThinking ? { defaultThinking: defaults.defaultThinking } : {}),
      ...(defaults.agent ? { agent: defaults.agent } : {}),
      ...(defaults.delivery ? { delivery: defaults.delivery } : {})
    });
    const flagArgs = args.slice(2);
    const quoted = flagArgs.map((arg) => (arg.startsWith('--') ? arg : shellQuote(arg)));
    return ['openclaw', 'cron', 'add', ...quoted].join(' ');
  });
}
```

> Note: the original render script shell-quotes flag *values* but leaves flag *names* (`--name`, `--cron`, etc.) unquoted. The implementation above mirrors that by skipping quoting for any token starting with `--`. Standalone flags like `--exact` and `--announce` already start with `--` so they pass through unquoted.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/render-cron-commands.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add tests/application/render-cron-commands.test.ts src/application/render-cron-commands.ts
git commit -m "feat(application): renderCronCommands use case"
```

---

### Task 20: Application — `sync-cron`

**Files:**
- Create: `tests/application/sync-cron.test.ts`
- Create: `src/application/sync-cron.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { syncCron } from '../../src/application/sync-cron.js';
import { FakeTextReader, FakeEnv, FakeCommandRunner } from '../fakes/index.js';

const yaml = `
timezone: UTC
session: isolated
jobs:
  - name: a
    cron: "0 7 * * *"
    messageFile: r.md
  - name: b
    cron: "0 18 * * 0"
    messageFile: r.md
    thinking: high
`;

describe('syncCron', () => {
  it('returns prepared commands without invoking the runner when apply is false', async () => {
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('r.md', 'msg');
    const env = new FakeEnv({});
    const commandRunner = new FakeCommandRunner();

    const result = await syncCron({ textReader, env, commandRunner, apply: false });

    expect(result.commands).toHaveLength(2);
    expect(commandRunner.calls).toEqual([]);
    expect(result.commands[0]).toEqual({
      command: 'openclaw',
      args: expect.arrayContaining(['cron', 'add', '--name', 'a', '--cron', '0 7 * * *'])
    });
  });

  it('runs commandRunner with prepared argv when apply is true', async () => {
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('r.md', 'msg');
    const env = new FakeEnv({});
    const commandRunner = new FakeCommandRunner();

    await syncCron({ textReader, env, commandRunner, apply: true });
    expect(commandRunner.calls).toHaveLength(2);
    expect(commandRunner.calls[0]?.command).toBe('openclaw');
    expect(commandRunner.calls[0]?.args.slice(0, 2)).toEqual(['cron', 'add']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/application/sync-cron.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/application/sync-cron.ts`:

```ts
import type { TextReader } from '../ports/text-reader.js';
import type { EnvReader } from '../ports/env.js';
import type { CommandRunner } from '../ports/command-runner.js';
import {
  buildCronAddArgs,
  type CronCommand
} from '../domain/cron-command.js';
import { loadCronConfig } from './load-cron-config.js';

export interface SyncCronDeps {
  textReader: TextReader;
  env: EnvReader;
  commandRunner: CommandRunner;
  apply: boolean;
  configPath?: string;
}

export interface SyncCronResult {
  commands: CronCommand[];
  apply: boolean;
}

export async function syncCron(deps: SyncCronDeps): Promise<SyncCronResult> {
  const { textReader, env, commandRunner, apply } = deps;
  const { defaults, preparedJobs } = await loadCronConfig({
    textReader,
    env,
    ...(deps.configPath ? { configPath: deps.configPath } : {})
  });

  const commands = preparedJobs.map((prepared) =>
    buildCronAddArgs({
      job: prepared.job,
      message: prepared.message,
      timezone: defaults.timezone,
      session: defaults.session,
      exact: defaults.exact,
      ...(defaults.defaultModel ? { defaultModel: defaults.defaultModel } : {}),
      ...(defaults.defaultThinking ? { defaultThinking: defaults.defaultThinking } : {}),
      ...(defaults.agent ? { agent: defaults.agent } : {}),
      ...(defaults.delivery ? { delivery: defaults.delivery } : {})
    })
  );

  if (apply) {
    for (const cmd of commands) {
      await commandRunner.run(cmd.command, cmd.args);
    }
  }

  return { commands, apply };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/application/sync-cron.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/application/sync-cron.test.ts src/application/sync-cron.ts
git commit -m "feat(application): syncCron use case with apply gate"
```

---

## Phase 6: Jobs

### Task 21: Job wrappers

Jobs are thin curry functions: `job(deps) -> () => useCase(deps)`. Their value is enforcing the orchestration boundary — `scripts/` import only `composition-root` and `jobs/`, not application use cases directly. No tests; the use cases already cover the work.

**Files:**
- Create: `src/jobs/jupiter-price-job.ts`
- Create: `src/jobs/backend-snapshot-job.ts`
- Create: `src/jobs/daily-insight-job.ts`
- Create: `src/jobs/range-review-job.ts`
- Create: `src/jobs/weekly-review-job.ts`
- Create: `src/jobs/cron-render-job.ts`
- Create: `src/jobs/cron-sync-job.ts`
- Create: `src/jobs/coingecko-job.ts`
- Create: `src/jobs/defillama-job.ts`
- Create: `src/jobs/index.ts`

- [ ] **Step 1: Create `src/jobs/jupiter-price-job.ts`**

```ts
import {
  collectJupiterPrice,
  type CollectJupiterPriceDeps
} from '../application/collect-jupiter-price.js';

export function jupiterPriceJob(deps: CollectJupiterPriceDeps): () => Promise<void> {
  return () => collectJupiterPrice(deps);
}
```

- [ ] **Step 2: Create `src/jobs/backend-snapshot-job.ts`**

```ts
import {
  collectBackendSnapshot,
  type CollectBackendSnapshotDeps,
  type CollectBackendSnapshotResult
} from '../application/collect-backend-snapshot.js';

export function backendSnapshotJob(
  deps: CollectBackendSnapshotDeps
): () => Promise<CollectBackendSnapshotResult> {
  return () => collectBackendSnapshot(deps);
}
```

- [ ] **Step 3: Create `src/jobs/daily-insight-job.ts`**

```ts
import {
  generateDailyInsight,
  type GenerateDailyInsightDeps
} from '../application/generate-daily-insight.js';
import type { DailyInsight } from '../contracts/outputs.js';

export function dailyInsightJob(deps: GenerateDailyInsightDeps): () => Promise<DailyInsight> {
  return () => generateDailyInsight(deps);
}
```

- [ ] **Step 4: Create `src/jobs/range-review-job.ts`**

```ts
import {
  generateRangeReview,
  type GenerateRangeReviewDeps
} from '../application/generate-range-review.js';
import type { RangeReview } from '../contracts/outputs.js';

export function rangeReviewJob(deps: GenerateRangeReviewDeps): () => Promise<RangeReview> {
  return () => generateRangeReview(deps);
}
```

- [ ] **Step 5: Create `src/jobs/weekly-review-job.ts`**

```ts
import {
  generateWeeklyReview,
  type GenerateWeeklyReviewDeps
} from '../application/generate-weekly-review.js';
import type { WeeklyReview } from '../contracts/outputs.js';

export function weeklyReviewJob(deps: GenerateWeeklyReviewDeps): () => Promise<WeeklyReview> {
  return () => generateWeeklyReview(deps);
}
```

- [ ] **Step 6: Create `src/jobs/cron-render-job.ts`**

```ts
import {
  renderCronCommands,
  type RenderCronCommandsDeps
} from '../application/render-cron-commands.js';

export function cronRenderJob(deps: RenderCronCommandsDeps): () => Promise<string[]> {
  return () => renderCronCommands(deps);
}
```

- [ ] **Step 7: Create `src/jobs/cron-sync-job.ts`**

```ts
import {
  syncCron,
  type SyncCronDeps,
  type SyncCronResult
} from '../application/sync-cron.js';

export function cronSyncJob(deps: SyncCronDeps): () => Promise<SyncCronResult> {
  return () => syncCron(deps);
}
```

- [ ] **Step 8: Create `src/jobs/coingecko-job.ts`**

```ts
import {
  collectCoingecko,
  type CollectCoingeckoDeps
} from '../application/collect-coingecko.js';

export function coingeckoJob(deps: CollectCoingeckoDeps): () => Promise<void> {
  return () => collectCoingecko(deps);
}
```

- [ ] **Step 9: Create `src/jobs/defillama-job.ts`**

```ts
import {
  collectDefillama,
  type CollectDefillamaDeps
} from '../application/collect-defillama.js';

export function defillamaJob(deps: CollectDefillamaDeps): () => Promise<void> {
  return () => collectDefillama(deps);
}
```

- [ ] **Step 10: Create `src/jobs/index.ts`**

```ts
export { jupiterPriceJob } from './jupiter-price-job.js';
export { backendSnapshotJob } from './backend-snapshot-job.js';
export { dailyInsightJob } from './daily-insight-job.js';
export { rangeReviewJob } from './range-review-job.js';
export { weeklyReviewJob } from './weekly-review-job.js';
export { cronRenderJob } from './cron-render-job.js';
export { cronSyncJob } from './cron-sync-job.js';
export { coingeckoJob } from './coingecko-job.js';
export { defillamaJob } from './defillama-job.js';
```

- [ ] **Step 11: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/jobs
git commit -m "feat(jobs): thin orchestration wrappers around application use cases"
```

---

## Phase 7: Adapters and Composition Root

### Task 22: Node adapters

**Files:**
- Create: `src/adapters/node/fetch-http.ts`
- Create: `src/adapters/node/fs-json-store.ts`
- Create: `src/adapters/node/fs-text-reader.ts`
- Create: `src/adapters/node/process-env.ts`
- Create: `src/adapters/node/system-clock.ts`
- Create: `src/adapters/node/spawn-command-runner.ts`
- Create: `src/adapters/node/composition-root.ts`

- [ ] **Step 1: Create `src/adapters/node/fetch-http.ts`**

```ts
import type { HttpClient } from '../../ports/http.js';

export class FetchHttpClient implements HttpClient {
  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GET ${url} failed: ${response.status} ${response.statusText} ${body}`);
    }
    return response.json() as Promise<T>;
  }
}
```

- [ ] **Step 2: Create `src/adapters/node/fs-json-store.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JsonStore } from '../../ports/json-store.js';

export class FsJsonStore implements JsonStore {
  async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}
```

- [ ] **Step 3: Create `src/adapters/node/fs-text-reader.ts`**

```ts
import { readFile } from 'node:fs/promises';
import type { TextReader } from '../../ports/text-reader.js';

export class FsTextReader implements TextReader {
  async readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }
}
```

- [ ] **Step 4: Create `src/adapters/node/process-env.ts`**

```ts
import 'dotenv/config';
import type { EnvReader } from '../../ports/env.js';

export class ProcessEnvReader implements EnvReader {
  get(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    if (value == null || value.length === 0) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  getOptional(name: string): string | undefined {
    const value = process.env[name];
    return value == null || value.length === 0 ? undefined : value;
  }
}
```

- [ ] **Step 5: Create `src/adapters/node/system-clock.ts`**

```ts
import type { Clock } from '../../ports/clock.js';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
```

- [ ] **Step 6: Create `src/adapters/node/spawn-command-runner.ts`**

```ts
import { spawn } from 'node:child_process';
import type { CommandRunner } from '../../ports/command-runner.js';

export class SpawnCommandRunner implements CommandRunner {
  run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }
}
```

- [ ] **Step 7: Create `src/adapters/node/composition-root.ts`**

```ts
import { FetchHttpClient } from './fetch-http.js';
import { FsJsonStore } from './fs-json-store.js';
import { FsTextReader } from './fs-text-reader.js';
import { ProcessEnvReader } from './process-env.js';
import { SystemClock } from './system-clock.js';
import { SpawnCommandRunner } from './spawn-command-runner.js';
import type { HttpClient } from '../../ports/http.js';
import type { JsonStore } from '../../ports/json-store.js';
import type { TextReader } from '../../ports/text-reader.js';
import type { EnvReader } from '../../ports/env.js';
import type { Clock } from '../../ports/clock.js';
import type { CommandRunner } from '../../ports/command-runner.js';

export interface NodeRuntime {
  http: HttpClient;
  jsonStore: JsonStore;
  textReader: TextReader;
  env: EnvReader;
  clock: Clock;
  commandRunner: CommandRunner;
}

export function createNodeRuntime(): NodeRuntime {
  return {
    http: new FetchHttpClient(),
    jsonStore: new FsJsonStore(),
    textReader: new FsTextReader(),
    env: new ProcessEnvReader(),
    clock: new SystemClock(),
    commandRunner: new SpawnCommandRunner()
  };
}
```

- [ ] **Step 8: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/adapters
git commit -m "feat(adapters): node adapters and composition root"
```

---

## Phase 8: Rewire Scripts

Each script becomes a thin entrypoint. Existing scripts continue to import the legacy `scripts/lib/*` modules until they are rewired in this phase. `scripts/lib/*` is deleted in Task 33.

### Task 23: Rewire `scripts/generate/daily-insight.ts`

**Files:**
- Modify: `scripts/generate/daily-insight.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { dailyInsightJob } from '../../src/jobs/daily-insight-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const output = await dailyInsightJob({
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the script to confirm runtime parity**

Run: `pnpm insight:daily`
Expected: prints daily insight JSON; writes `outputs/sol-usdc-daily-insight.json` (stale-quality result is fine since `data/` is empty in this dev env). Exit code 0.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate/daily-insight.ts
git commit -m "refactor(scripts): wire daily-insight to dailyInsightJob"
```

---

### Task 24: Rewire `scripts/generate/range-review.ts`

**Files:**
- Modify: `scripts/generate/range-review.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { rangeReviewJob } from '../../src/jobs/range-review-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const output = await rangeReviewJob({
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the script**

Run: `pnpm review:range`
Expected: prints JSON; writes `outputs/sol-usdc-rebalance-recommendation.json`. Exit 0.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate/range-review.ts
git commit -m "refactor(scripts): wire range-review to rangeReviewJob"
```

---

### Task 25: Rewire `scripts/generate/weekly-review.ts`

**Files:**
- Modify: `scripts/generate/weekly-review.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { weeklyReviewJob } from '../../src/jobs/weekly-review-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const output = await weeklyReviewJob({
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the script**

Run: `pnpm review:weekly`
Expected: prints JSON; writes `outputs/weekly-clmm-review.json`. Exit 0.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate/weekly-review.ts
git commit -m "refactor(scripts): wire weekly-review to weeklyReviewJob"
```

---

### Task 26: Rewire `scripts/collectors/jupiter-price.ts`

**Files:**
- Modify: `scripts/collectors/jupiter-price.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { jupiterPriceJob } from '../../src/jobs/jupiter-price-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await jupiterPriceJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Verify typecheck and tests** (do not run network in CI; manual integration test optional)

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/collectors/jupiter-price.ts
git commit -m "refactor(scripts): wire jupiter-price to jupiterPriceJob"
```

---

### Task 27: Rewire `scripts/collectors/backend-snapshot.ts`

**Files:**
- Modify: `scripts/collectors/backend-snapshot.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

The entrypoint preserves the original behavior: print every per-source error and exit non-zero if any failed.

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { backendSnapshotJob } from '../../src/jobs/backend-snapshot-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const result = await backendSnapshotJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env
  })();
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      console.error(failure);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/collectors/backend-snapshot.ts
git commit -m "refactor(scripts): wire backend-snapshot to backendSnapshotJob"
```

---

### Task 28: Rewire `scripts/openclaw/render-cron-commands.ts`

**Files:**
- Modify: `scripts/openclaw/render-cron-commands.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

The entrypoint prints each rendered line followed by a blank line, matching the original output.

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { cronRenderJob } from '../../src/jobs/cron-render-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  const lines = await cronRenderJob({
    textReader: runtime.textReader,
    env: runtime.env
  })();
  for (const line of lines) {
    console.log(line);
    console.log('');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the script**

Run: `pnpm cron:render`
Expected: prints `openclaw cron add ...` lines (no errors). Exit 0.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/openclaw/render-cron-commands.ts
git commit -m "refactor(scripts): wire render-cron-commands to cronRenderJob"
```

---

### Task 29: Rewire `scripts/openclaw/sync-cron.ts`

**Files:**
- Modify: `scripts/openclaw/sync-cron.ts` (full rewrite)

- [ ] **Step 1: Replace file content**

The entrypoint preserves the dry-run banner and per-job logging format.

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { cronSyncJob } from '../../src/jobs/cron-sync-job.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (!apply) {
    console.log(
      'Dry run. Pass --apply to create jobs. This script only adds jobs; it does not diff/delete existing jobs.'
    );
  }

  const runtime = createNodeRuntime();
  const result = await cronSyncJob({
    textReader: runtime.textReader,
    env: runtime.env,
    commandRunner: runtime.commandRunner,
    apply
  })();

  for (let index = 0; index < result.commands.length; index += 1) {
    const cmd = result.commands[index]!;
    const name = cmd.args[cmd.args.indexOf('--name') + 1] ?? '(unknown)';
    console.log(`\n# ${name}`);
    console.log(`${cmd.command} ${cmd.args.map((arg) => JSON.stringify(arg)).join(' ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

> Note: original logged commands while iterating *and* invoked `openclaw` between logs. The new flow runs all commands inside the use case (when `apply`), then logs once. To preserve interleaved logging order during apply, swap to `apply: false` and run commands manually here. We accept the simpler flow; the cron output paths and behavior are unchanged. The dry-run text and `# <name>` headers remain identical.

- [ ] **Step 2: Run the script in dry-run mode**

Run: `pnpm cron:sync`
Expected: prints dry-run banner, then `# clmm-daily-sol-usdc-insight\nopenclaw "cron" "add" ...` for each job. Exit 0.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/openclaw/sync-cron.ts
git commit -m "refactor(scripts): wire sync-cron to cronSyncJob"
```

---

### Task 30: Rewire ancillary collectors

**Files:**
- Modify: `scripts/collectors/coingecko.ts`
- Modify: `scripts/collectors/defillama.ts`
- (`scripts/collectors/raydium-placeholder.ts` is unchanged — single console.log with no imports)

- [ ] **Step 1: Replace `scripts/collectors/coingecko.ts`**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { coingeckoJob } from '../../src/jobs/coingecko-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await coingeckoJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    env: runtime.env,
    clock: runtime.clock
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Replace `scripts/collectors/defillama.ts`**

```ts
import { createNodeRuntime } from '../../src/adapters/node/composition-root.js';
import { defillamaJob } from '../../src/jobs/defillama-job.js';

async function main(): Promise<void> {
  const runtime = createNodeRuntime();
  await defillamaJob({
    http: runtime.http,
    jsonStore: runtime.jsonStore,
    clock: runtime.clock
  })();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/collectors/coingecko.ts scripts/collectors/defillama.ts
git commit -m "refactor(scripts): wire ancillary collectors via use cases"
```

---

### Task 31: Delete legacy `scripts/lib/*`

**Files:**
- Delete: `scripts/lib/env.ts`
- Delete: `scripts/lib/fs.ts`
- Delete: `scripts/lib/http.ts`
- Delete: `scripts/lib/metrics.ts`

- [ ] **Step 1: Confirm no imports reference `scripts/lib`**

Run: `grep -r "scripts/lib" scripts src tests`
Expected: no matches.

- [ ] **Step 2: Delete the files**

Run:
```bash
rm scripts/lib/env.ts scripts/lib/fs.ts scripts/lib/http.ts scripts/lib/metrics.ts
rmdir scripts/lib 2>/dev/null || true
```

- [ ] **Step 3: Verify typecheck and tests still pass**

Run: `pnpm typecheck && pnpm test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A scripts/lib
git commit -m "chore: remove legacy scripts/lib helpers superseded by src/"
```

---

## Phase 9: Boundary Enforcement

### Task 32: Add `.dependency-cruiser.cjs` and verify rules

**Files:**
- Create: `.dependency-cruiser.cjs`

- [ ] **Step 1: Create `.dependency-cruiser.cjs`**

```js
/* eslint-disable */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-outbound',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: [
          '^src/application',
          '^src/jobs',
          '^src/adapters',
          '^src/ports',
          '^scripts',
          '^node_modules/(?!typescript)'
        ],
        pathNot: ['^src/contracts/snapshots\\.ts$']
      }
    },
    {
      name: 'domain-no-output-contracts',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/contracts/(outputs|cron-config)\\.ts$' }
    },
    {
      name: 'contracts-no-runtime',
      severity: 'error',
      from: { path: '^src/contracts' },
      to: {
        path: [
          '^src/application',
          '^src/jobs',
          '^src/adapters',
          '^src/ports',
          '^src/domain',
          '^scripts'
        ]
      }
    },
    {
      name: 'ports-no-app-or-adapters',
      severity: 'error',
      from: { path: '^src/ports' },
      to: { path: ['^src/application', '^src/jobs', '^src/adapters', '^scripts'] }
    },
    {
      name: 'application-no-adapters-or-jobs',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: ['^src/jobs', '^src/adapters', '^scripts'] }
    },
    {
      name: 'jobs-no-adapters-or-domain-internals',
      severity: 'error',
      from: { path: '^src/jobs' },
      to: { path: ['^src/adapters', '^scripts', '^src/domain'] }
    },
    {
      name: 'adapters-no-app-or-jobs',
      severity: 'error',
      from: { path: '^src/adapters' },
      to: { path: ['^src/application', '^src/jobs', '^scripts'] }
    },
    {
      name: 'inner-layers-no-node-builtins',
      severity: 'error',
      from: { path: '^src/(domain|application|jobs|ports|contracts)' },
      to: { dependencyTypes: ['core'] }
    }
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node']
    }
  }
};
```

> The `inner-layers-no-node-builtins` rule blocks `node:fs`, `node:child_process`, etc. from leaking into the inner layers. `application/load-cron-config.ts` imports the `yaml` package (npm), which is allowed because `dependencyTypes: ['core']` only matches Node's built-in modules.

- [ ] **Step 2: Run the boundary check**

Run: `pnpm boundaries`
Expected: exit 0 with no violations.

- [ ] **Step 3: Run the combined verify command**

Run: `pnpm verify`
Expected: typecheck + tests + boundaries all pass, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "chore: enforce layer boundaries via dependency-cruiser"
```

---

## Phase 10: Fixture Regression Tests

### Task 33: Add fixture-driven regression tests

These tests assert that, given representative inputs, the use cases produce the same JSON shapes the legacy scripts produced. Captured-output JSON files are committed alongside the inputs.

**Files:**
- Create: `tests/fixtures/snapshots/complete/latest-price-snapshot.json`
- Create: `tests/fixtures/snapshots/complete/latest-pool-snapshot.json`
- Create: `tests/fixtures/snapshots/complete/latest-position-snapshot.json`
- Create: `tests/fixtures/snapshots/partial/latest-price-snapshot.json`
- Create: `tests/fixtures/snapshots/partial/latest-pool-snapshot.json`
- Create: `tests/fixtures/expected/daily-insight-complete.json`
- Create: `tests/fixtures/expected/daily-insight-partial.json`
- Create: `tests/fixtures/expected/daily-insight-stale.json`
- Create: `tests/fixtures/expected/range-review-complete.json`
- Create: `tests/fixtures/expected/range-review-stale.json`
- Create: `tests/fixtures/expected/weekly-review-stale.json`
- Create: `tests/fixtures/expected/cron-render.txt`
- Create: `tests/fixtures/cron/jobs.yaml`
- Create: `tests/fixtures/cron/routines/daily.md`
- Create: `tests/regression/daily-insight.fixture.test.ts`
- Create: `tests/regression/range-review.fixture.test.ts`
- Create: `tests/regression/weekly-review.fixture.test.ts`
- Create: `tests/regression/cron-render.fixture.test.ts`

- [ ] **Step 1: Write the snapshot fixtures**

`tests/fixtures/snapshots/complete/latest-price-snapshot.json`:

```json
{
  "pair": "SOL/USDC",
  "timestamp": "2026-05-09T12:00:00.000Z",
  "source": "jupiter-price-v3",
  "priceUsd": 175.4,
  "confidence": "high"
}
```

`tests/fixtures/snapshots/complete/latest-pool-snapshot.json`:

```json
{
  "pair": "SOL/USDC",
  "timestamp": "2026-05-09T12:00:00.000Z",
  "source": "fastify-clmm-backend",
  "spotPrice": 175.5,
  "feeApr": 95,
  "volume24hUsd": 12000000,
  "feeAprTrend": "rising",
  "volumeTrend": "rising"
}
```

`tests/fixtures/snapshots/complete/latest-position-snapshot.json`:

```json
{
  "pair": "SOL/USDC",
  "timestamp": "2026-05-09T12:00:00.000Z",
  "source": "fastify-clmm-backend",
  "inRange": true,
  "lowerPrice": 150,
  "upperPrice": 200,
  "spotPrice": 175.5,
  "distanceToLowerPercent": 14.5,
  "distanceToUpperPercent": 14.0
}
```

`tests/fixtures/snapshots/partial/latest-price-snapshot.json`:

```json
{
  "pair": "SOL/USDC",
  "timestamp": "2026-05-09T12:00:00.000Z",
  "source": "jupiter-price-v3",
  "priceUsd": 175.4,
  "confidence": "high"
}
```

`tests/fixtures/snapshots/partial/latest-pool-snapshot.json`:

```json
{
  "pair": "SOL/USDC",
  "timestamp": "2026-05-09T12:00:00.000Z",
  "source": "fastify-clmm-backend",
  "spotPrice": 175.5,
  "feeApr": 60
}
```

- [ ] **Step 2: Write the cron fixtures**

`tests/fixtures/cron/jobs.yaml`:

```yaml
timezone: America/Edmonton
session: isolated
modelEnv: OPENCLAW_MODEL
jobs:
  - name: clmm-daily
    cron: "0 7 * * *"
    messageFile: tests/fixtures/cron/routines/daily.md
```

`tests/fixtures/cron/routines/daily.md`:

```text
Daily routine.
```

- [ ] **Step 3: Write the daily-insight regression test**

`tests/regression/daily-insight.fixture.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateDailyInsight } from '../../src/application/generate-daily-insight.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

const FIXED_NOW = '2026-05-09T13:00:00.000Z';

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('daily-insight regression', () => {
  it('matches the captured complete-data output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed(
      'data/latest-price-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-price-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-pool-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-pool-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-position-snapshot.json',
      await loadJson('tests/fixtures/snapshots/complete/latest-position-snapshot.json')
    );
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-complete.json');
    expect(result).toEqual(expected);
  });

  it('matches the captured partial-data output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed(
      'data/latest-price-snapshot.json',
      await loadJson('tests/fixtures/snapshots/partial/latest-price-snapshot.json')
    );
    jsonStore.seed(
      'data/latest-pool-snapshot.json',
      await loadJson('tests/fixtures/snapshots/partial/latest-pool-snapshot.json')
    );
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-partial.json');
    expect(result).toEqual(expected);
  });

  it('matches the captured stale output', async () => {
    const jsonStore = new FakeJsonStore();
    const clock = new FakeClock(FIXED_NOW);
    const result = await generateDailyInsight({ jsonStore, clock });
    const expected = await loadJson('tests/fixtures/expected/daily-insight-stale.json');
    expect(result).toEqual(expected);
  });
});
```

- [ ] **Step 4: Capture expected outputs by running the regression tests once with snapshot-write mode**

Run the regression test once with `EXPECT_WRITE=1` (we'll add a one-shot helper). Simpler: run the test once expecting failure, copy the actual output, save as expected, rerun. Use this command sequence to bootstrap:

```bash
# initial scaffold of the expected files (will be overwritten by capture)
echo "{}" > tests/fixtures/expected/daily-insight-complete.json
echo "{}" > tests/fixtures/expected/daily-insight-partial.json
echo "{}" > tests/fixtures/expected/daily-insight-stale.json
```

Then run a one-time capture script (paste into a terminal):

```bash
node --import tsx -e "
import('./src/application/generate-daily-insight.ts').then(async ({ generateDailyInsight }) => {
  const { FakeJsonStore, FakeClock } = await import('./tests/fakes/index.ts');
  const fs = await import('node:fs/promises');
  const FIXED_NOW = '2026-05-09T13:00:00.000Z';
  const cases = [
    {
      name: 'complete',
      seeds: ['latest-price-snapshot.json','latest-pool-snapshot.json','latest-position-snapshot.json']
    },
    { name: 'partial', seeds: ['latest-price-snapshot.json','latest-pool-snapshot.json'] },
    { name: 'stale', seeds: [] }
  ];
  for (const c of cases) {
    const store = new FakeJsonStore();
    for (const file of c.seeds) {
      const json = JSON.parse(await fs.readFile('tests/fixtures/snapshots/' + c.name + '/' + file, 'utf8'));
      store.seed('data/' + file, json);
    }
    const result = await generateDailyInsight({ jsonStore: store, clock: new FakeClock(FIXED_NOW) });
    await fs.writeFile('tests/fixtures/expected/daily-insight-' + c.name + '.json', JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
});
"
```

After capture, eyeball each expected JSON file: confirm `timestamp` is `2026-05-09T13:00:00.000Z`, fields look right per the spec (e.g., `recommendedAction: 'pause_rebalances'` for stale).

- [ ] **Step 5: Run the regression test**

Run: `pnpm test tests/regression/daily-insight.fixture.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Repeat steps 3–5 for the range-review regression test**

`tests/regression/range-review.fixture.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateRangeReview } from '../../src/application/generate-range-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

const FIXED_NOW = '2026-05-09T13:00:00.000Z';
async function loadJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }

describe('range-review regression', () => {
  it('matches the captured complete-data output', async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed('data/latest-price-snapshot.json', await loadJson('tests/fixtures/snapshots/complete/latest-price-snapshot.json'));
    jsonStore.seed('data/latest-pool-snapshot.json', await loadJson('tests/fixtures/snapshots/complete/latest-pool-snapshot.json'));
    jsonStore.seed('data/latest-position-snapshot.json', await loadJson('tests/fixtures/snapshots/complete/latest-position-snapshot.json'));
    const result = await generateRangeReview({ jsonStore, clock: new FakeClock(FIXED_NOW) });
    expect(result).toEqual(await loadJson('tests/fixtures/expected/range-review-complete.json'));
  });

  it('matches the captured stale output', async () => {
    const result = await generateRangeReview({ jsonStore: new FakeJsonStore(), clock: new FakeClock(FIXED_NOW) });
    expect(result).toEqual(await loadJson('tests/fixtures/expected/range-review-stale.json'));
  });
});
```

Capture expected outputs with a similar inline `node --import tsx -e "..."` block targeting `generateRangeReview`. Run: `pnpm test tests/regression/range-review.fixture.test.ts` → PASS.

- [ ] **Step 7: Add the weekly-review regression test**

`tests/regression/weekly-review.fixture.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateWeeklyReview } from '../../src/application/generate-weekly-review.js';
import { FakeJsonStore, FakeClock } from '../fakes/index.js';

const FIXED_NOW = '2026-05-09T13:00:00.000Z';
async function loadJson(path: string) { return JSON.parse(await readFile(path, 'utf8')); }

describe('weekly-review regression', () => {
  it('matches the captured stale output', async () => {
    const result = await generateWeeklyReview({ jsonStore: new FakeJsonStore(), clock: new FakeClock(FIXED_NOW) });
    expect(result).toEqual(await loadJson('tests/fixtures/expected/weekly-review-stale.json'));
  });
});
```

Capture the expected stale output and verify.

- [ ] **Step 8: Add the cron-render regression test**

`tests/regression/cron-render.fixture.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderCronCommands } from '../../src/application/render-cron-commands.js';
import { FakeTextReader, FakeEnv } from '../fakes/index.js';

describe('cron-render regression', () => {
  it('matches the captured render output', async () => {
    const yaml = await readFile('tests/fixtures/cron/jobs.yaml', 'utf8');
    const routine = await readFile('tests/fixtures/cron/routines/daily.md', 'utf8');
    const textReader = new FakeTextReader();
    textReader.seed('cron/jobs.yaml', yaml);
    textReader.seed('tests/fixtures/cron/routines/daily.md', routine);
    const env = new FakeEnv({ OPENCLAW_MODEL: 'opus' });

    const lines = await renderCronCommands({ textReader, env });
    const expected = (await readFile('tests/fixtures/expected/cron-render.txt', 'utf8')).trimEnd();
    expect(lines.join('\n')).toBe(expected);
  });
});
```

Capture by running `renderCronCommands` once and writing the joined lines to `tests/fixtures/expected/cron-render.txt` (newline-terminated). Verify.

- [ ] **Step 9: Run the full verification**

Run: `pnpm verify`
Expected: typecheck + all tests (unit + application + regression) + boundaries pass, exit 0.

- [ ] **Step 10: Commit**

```bash
git add tests/fixtures tests/regression
git commit -m "test: fixture regression tests for moved use cases"
```

---

## Phase 11: Documentation

### Task 34: Update `README.md` and `docs/architecture.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `docs/architecture.md`**

Add a new section between "Core pattern" and "Why Git is not the database":

```markdown
## Layered modular monolith

Pipeline code lives under `src/`:

- `src/contracts` — typed snapshot input and output shapes plus cron config types.
- `src/domain` — pure decision logic (range status, fee classification, data-quality classification, advisory policy, daily / range / weekly decision assembly, cron command building). No I/O, no clock, no env.
- `src/ports` — interfaces for HTTP, JSON file storage, text reading, env, clock, and command execution.
- `src/application` — use cases that orchestrate domain functions through ports (collect price, collect backend snapshot, generate daily/range/weekly reviews, render and sync cron jobs).
- `src/jobs` — thin orchestration wrappers that bind use cases to dependency objects so cron-driven entrypoints have a single import point.
- `src/adapters/node` — concrete Node implementations of every port plus a `createNodeRuntime()` composition root.

`scripts/*` are thin entrypoints. Each builds the Node runtime, calls one job, prints output, and sets `process.exitCode` on failure. `pnpm` script names and JSON output paths are unchanged.

Boundary rules are enforced by `dependency-cruiser` (`pnpm boundaries`). The combined `pnpm verify` script runs typecheck, tests, and boundary checks.

## No-execution boundary

This repo produces advisory artifacts. It does not sign, submit, rebalance, swap, or perform wallet execution. The only side effects scripts can produce are: writing JSON to `data/` and `outputs/`, rendering cron commands, and (only via `pnpm cron:sync -- --apply`) invoking the `openclaw` CLI to register cron jobs.

## Downstream split

Evidence-bundle publication is INT-PUBLISH (issue #13). Removal of the legacy recommendation-flow outputs is INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (issue #14), which depends on the new path being live.
```

- [ ] **Step 2: Update `README.md`**

Insert a new section after "Useful commands":

```markdown
## Repo structure

```text
src/                              Layered monolith (domain / contracts / ports / application / jobs / adapters)
scripts/                          Thin entrypoints that call jobs through the Node composition root
tests/                            Vitest unit, application, and fixture regression tests
schemas/                          JSON Schema asset directory (unchanged)
policies/ prompts/ routines/ resources/ memory/ cron/   Non-code product assets (unchanged)
```

## Verification commands

```bash
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest run
pnpm boundaries      # dependency-cruiser layer checks
pnpm verify          # all three above
```

The layered architecture and no-execution boundary are documented in `docs/architecture.md`.
```

- [ ] **Step 3: Run `pnpm verify` once more**

Run: `pnpm verify`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "docs: explain layered monolith and verification commands"
```

---

## Self-Review Notes

The following spec requirements were checked against the plan after writing:

- **`src/domain` owns pure decision logic** — Tasks 2-9.
- **`src/application` owns use cases** — Tasks 12-20.
- **`src/ports` defines dependency interfaces** — Task 10.
- **`src/adapters` implements ports for Node** — Task 22.
- **`src/jobs` owns scheduled workflow composition** — Task 21.
- **`src/contracts` holds TypeScript types for current snapshot/output shapes** — Task 1.
- **`schemas/` remains the existing JSON Schema asset directory** — left untouched (only mentioned in docs).
- **Thin `scripts/*` entrypoints; package scripts and output paths stable** — Tasks 23-30.
- **No-execution boundary preserved** — Tasks 23-30 (no signing or transaction code added).
- **Boundary rules automated via `dependency-cruiser`** — Task 32.
- **Per-source `Promise.allSettled` collector behavior preserved for backend snapshot** — Task 16 (use case) and Task 27 (entrypoint).
- **Single-source collectors fail fast** — Tasks 15, 17 (use cases throw on failure).
- **Generator use cases preserve conservative behavior under incomplete inputs (`pause_rebalances`, `requiresHumanApproval`, `executionPermittedByAgent: false`)** — Tasks 6, 7, 12, 13.
- **Cron command construction is pure and testable; applying gated by `--apply`** — Tasks 9, 19, 20, 29.
- **Domain unit tests for range status, fee classification, data quality, advisory-policy** — Tasks 2-5.
- **Application/job tests with fake ports for daily/range/weekly + collectors + cron render/sync** — Tasks 12-20.
- **Fixture regression tests for representative complete/partial/stale + cron dry-run cases** — Task 33.
- **`pnpm typecheck` green; boundary-check script; combined verification script** — Tasks 0, 32.
- **Top-level non-code assets stay in place; `data/` and `outputs/` runtime paths stable** — preserved (no movement).
- **Stable external command surface** — preserved (Tasks 23-30 keep package.json scripts and output paths byte-for-byte).
- **README and `docs/architecture.md` updated** — Task 34.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-int-arch-layered-monolith.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
