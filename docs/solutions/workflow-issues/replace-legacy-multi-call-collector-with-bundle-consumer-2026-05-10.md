---
title: Replace Legacy Multi-Call Collector with Bundle Consumer
date: 2026-05-10
category: workflow-issues
module: collector
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Replacing multiple parallel HTTP snapshot collectors with a single bundle endpoint
  - Consolidating N downstream consumers that each parse the same data differently
  - Performing a clean-break migration without a compatibility layer
symptoms:
  - Three separate HTTP calls to collect clmm-v2 data (pool, position, performance)
  - 57+ files involved in the legacy snapshot-to-insight pipeline
  - Duplicated parsing and normalization across 3 downstream generators
root_cause: workflow_issue
resolution_type: workflow_improvement
tags:
  - clmm-bundle
  - collector-replacement
  - workflow-refactor
  - typescript
  - legacy-migration
  - clean-break
  - subagent-driven-development
---

# Replace Legacy Multi-Call Collector with Bundle Consumer

## Context

The SOL/USDC CLMM intelligence repo had a legacy backend snapshot collector that made **3 separate HTTP calls** to a clmm-v2 backend, writing 3 independent JSON snapshot files. Three downstream generators each consumed one of these files to produce recommendations, range reviews, and daily insights. This resulted in:

- ~45 files of fragile, interconnected code
- 3x the network overhead per collection cycle
- Tight coupling between snapshot shape and generator logic
- High cognitive load for newcomers ("which snapshot feeds which generator?")
- Brittle error handling — any single snapshot failure required partial-retry logic

The fix: Replace all 3 calls with a single `/insights/sol-usdc/bundle/:walletId` endpoint that returns a complete typed `ClmmBundle` payload, then delete every legacy flow atomically.

## Guidance

The pattern follows 6 ordered steps. **Do not skip or reorder** — each step depends on the previous.

### Step 1: Define the canonical contract type

Create a single file under `src/contracts/` with all interfaces for the bundle payload. Pure types, no imports, no logic. The multi-position invariant is critical: `positions` is `PositionData[]` — never assume single position via `[0]`.

```typescript
// src/contracts/clmm-bundle.ts
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

export interface PositionData {
  positionId: string;
  rangeState: "in-range" | "below-range" | "above-range";
  lowerTick: number;
  upperTick: number;
  unclaimedFees: { feeOwedA: FeeAmount; feeOwedB: FeeAmount };
  unclaimedFeesUsd: number | null;
  hasActionableTrigger: boolean;
  // ...
}

export interface PoolData {
  poolId: string;
  currentPrice: number;
  tickCurrentIndex: number;
  feeRate: number;
  // ...
}
// etc.
```

### Step 2: Write tests first, expecting them to fail

Place tests at `tests/application/collect-clmm-bundle.test.ts`. Use existing fakes from `tests/fakes/` (`FakeHttp`, `FakeJsonStore`, `FakeEnv`). Cover:

1. Successful collection writes to expected path
2. Missing required bundle field throws
3. Wrong trading pair throws
4. Missing required env var throws
5. Trailing slash normalization on base URL

```typescript
it("throws when bundle pair is not SOL/USDC", async () => {
  const http = new FakeHttp();
  http.setResponse(url, { body: { bundle: { pair: "ETH/BTC" } } });
  const jsonStore = new FakeJsonStore();
  const env = new FakeEnv(VALID_ENV);
  await expect(collectClmmBundle({ http, jsonStore, env })).rejects.toThrow("pair");
});
```

### Step 3: Implement the use case

File at `src/application/collect-clmm-bundle.ts`. This is the core orchestration. Three-phase envelope validation: check bundle exists → cast → validate shape.

```typescript
import type { ClmmBundle } from "../contracts/clmm-bundle.js";
import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";

export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";

function validateEnvelope(response: Record<string, unknown>): ClmmBundle {
  const bundle = response.bundle;
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Response missing bundle field");
  }
  const b = bundle as Record<string, unknown>;
  if (b.pair !== "SOL/USDC") {
    throw new Error(`Expected pair SOL/USDC, got ${String(b.pair)}`);
  }
  if (!b.pool || typeof b.pool !== "object") {
    throw new Error("Bundle missing pool data");
  }
  if (!Array.isArray(b.positions)) {
    throw new Error("Bundle missing positions array");
  }
  return b as unknown as ClmmBundle;
}

export async function collectClmmBundle(deps: CollectClmmBundleDeps): Promise<void> {
  const { http, jsonStore, env } = deps;
  const base = env.get("CLMM_DATA_API_BASE");
  const apiKey = env.get("CLMM_INSIGHTS_API_KEY");
  const walletId = env.get("WALLET_PUBLIC_KEY");
  const normalized = base.replace(/\/$/, "");
  const url = `${normalized}/insights/sol-usdc/bundle/${walletId}`;
  const response = await http.getJson<Record<string, unknown>>(url, {
    "x-insights-api-key": apiKey
  });
  const bundle = validateEnvelope(response);
  await jsonStore.writeJson(CLMM_BUNDLE_PATH, bundle);
}
```

### Step 4: Wire the job and entrypoint

**Job** (`src/jobs/clmm-bundle-job.ts`): wrap use case in a zero-arg closure.

```typescript
export function clmmBundleJob(deps: CollectClmmBundleDeps): () => Promise<void> {
  return () => collectClmmBundle(deps);
}
```

**Entrypoint** (`scripts/collectors/clmm-bundle.ts`): create `NodeRuntime` and call the job.

**npm script** in `package.json`:

```json
"collect:clmm-bundle": "tsx scripts/collectors/clmm-bundle.ts"
```

### Step 5: Delete all legacy files atomically

Remove entire directory trees for domain logic, jobs, scripts, prompts, memory, schemas, test fixtures, and tests for legacy flows. The key invariant: **zero references remain** — `rg` for any legacy import path should return empty.

Target: single commit that atomically deletes all legacy files so `main` never lands in a broken state with partial references.

### Step 6: Update wiring and config

- `package.json`: remove 4 legacy script entries, add `collect:clmm-bundle`
- `.env.example`: add `CLMM_INSIGHTS_API_KEY` alongside `CLMM_DATA_API_BASE`
- `cron/jobs.yaml`: remove all 4 legacy job entries (daily-insight, range-review, weekly-review, emergency-volatility-check)
- `resources/sources.yaml`: rename/update source definition, add `apiKeyEnv` field
- `README` and `docs/operator-runbook.md`: update commands, env vars, and troubleshooting guidance

## Why This Matters

| Before                                    | After                                                    |
| ----------------------------------------- | -------------------------------------------------------- |
| 3 HTTP calls per cycle                    | 1 HTTP call per cycle                                    |
| ~45 legacy files                          | ~5 new files, 57 deleted                                 |
| 3 separate snapshot files to coordinate   | 1 typed bundle — the contract is the source of truth     |
| Generators coupled to snapshot filenames  | Single consumer decoupled from snapshot concern          |
| Fragile partial-failure edge cases        | Atomic: bundle is either valid or thrown                 |
| Newcomers need to understand 3 data flows | One flow: collect → normalize → derive → brief → publish |

The bundle pattern forces the **upstream API** to own the contract, not each downstream consumer.

## When to Apply

- You have multiple independent API calls that all fetch data about the **same entity** (same pool, same wallet)
- Downstream consumers each re-derive the **same base facts** from overlapping data
- The upstream API can be extended to return a **unified response**
- You're maintaining a **data pipeline** where snapshot staging is an intermediate step
- You're working within an **evidence-driven architecture** where bounded, typed evidence bundles are the unit of exchange

## Examples

**Before — 3 separate calls, 3 files, 3 generators:**

```
backend-snapshot-job
  ├── call /api/clmm/sol-usdc/pool-snapshot     → data/latest-pool-snapshot.json
  ├── call /api/clmm/sol-usdc/position-snapshot  → data/latest-position-snapshot.json
  └── call /api/clmm/sol-usdc/performance-snapshot → data/latest-performance-snapshot.json

daily-insight-job     ← reads pool + position
range-review-job      ← reads pool + position
weekly-review-job     ← reads performance
```

**After — 1 bundle call, 1 file, 1 collector:**

```
clmm-bundle-job
  └── call /insights/sol-usdc/bundle/{wallet} → data/latest-clmm-bundle.json
```

## Related

- See `docs/solutions/best-practices/script-first-to-layered-monolith-refactor-2026-05-10.md` for the architectural foundation (layered monolith with port/adapter DI) that enabled this collector replacement
- Issues: #4 (collector replacement), #14 (legacy flow deletion), #3 (evidence pipeline epic)
