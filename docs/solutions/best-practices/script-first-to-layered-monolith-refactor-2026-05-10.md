---
title: Script-first to layered modular monolith refactor
date: "2026-05-10"
category: best-practices
module: src
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - refactoring a TypeScript repo from script-first to modular monolith
  - introducing layered architecture with contracts/domain/ports/application pattern
  - enforcing boundary rules with dependency-cruiser
  - enabling testable domain logic without I/O infrastructure
symptoms:
  - tangled I/O in decision logic
  - untestable script helpers without dependency injection
  - no compile-time enforcement of layer boundaries
resolution_type: tooling_addition
related_components:
  - src/contracts
  - src/domain
  - src/ports
  - src/jobs
  - src/adapters
tags:
  - typescript
  - modular-monolith
  - layered-architecture
  - dependency-injection
  - dependency-cruiser
  - exact-optional-property-types
  - js-extension-imports
---

# Script-first to layered modular monolith refactor

## Context

A CLMM (Concentrated Liquidity Market Maker) autopilot pipeline for SOL/USDC started as a flat collection of scripts with a `scripts/lib/` helper folder. As the system grew to 8 domain decision modules, 9 application use cases, and 6 infrastructure interfaces, the script-first layout created friction: domain logic mixed with I/O, tests required real filesystem and network access, and there was no enforced boundary between layers. A 35-task refactor across 12 phases restructured the codebase into a layered modular monolith under `src/` with enforced dependency boundaries and dependency-injected testability.

## Guidance

**Adopt a layered modular monolith with enforced boundaries and port/adapter DI.**

### Layer structure and import rules

```
src/
  contracts/    — Typed snapshot input/output shapes + cron config types
                   (domain may only import contracts/snapshots, not outputs or cron-config)
  domain/       — 8 pure decision modules (no I/O, no clock, no env)
                   (imports only from contracts/snapshots)
  ports/        — 6 interface files (HttpClient, JsonStore, TextReader, EnvReader, Clock, CommandRunner)
                   (imports nothing from application, adapters, or jobs)
  application/  — 9 use cases orchestrating domain through ports
                   (imports domain + ports + contracts, never adapters)
  jobs/         — Thin curry wrappers: job(deps) -> () => useCase(deps)
                   (imports application + ports, never adapters or domain internals)
  adapters/node/ — Concrete Node implementations + createNodeRuntime() composition root
                   (imports only ports + Node built-ins)
```

### Dependency injection through ports

Each application use case takes a typed deps object built from port interfaces:

```typescript
// src/application/collect-jupiter-price.ts
import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { Clock } from "../ports/clock.js";

export interface CollectJupiterPriceDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
  clock: Clock;
}

export async function collectJupiterPrice(deps: CollectJupiterPriceDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  // ...orchestration logic using deps only through port interfaces
}
```

Tests inject fakes, not mocks:

```typescript
// tests/application/collect-jupiter-price.test.ts
const http = new FakeHttp();
http.setResponse(url, { body: { [SOL_MINT]: { usdPrice: 175.42 } } });
const jsonStore = new FakeJsonStore();
const env = new FakeEnv({ SOL_MINT });
const clock = new FakeClock("2026-05-10T12:30:00.000Z");

await collectJupiterPrice({ http, jsonStore, env, clock });
expect(jsonStore.writes[0]).toEqual(/* ... */);
```

### Domain purity — no I/O, no fakes needed

Domain modules import only `contracts/snapshots`:

```typescript
// src/domain/advisory-policy.ts
import type { BreachRisk, FeeEnvironment, Posture, ... } from '../contracts/outputs.js';
// Pure functions, no port interfaces, no side effects
export function derivePosture(inputs: ...): Posture { /* ... */ }
```

Domain tests are direct unit tests with plain data — no fakes, no infrastructure:

```typescript
// tests/domain/advisory-policy.test.ts
expect(
  derivePosture({ recommendedAction: "hold", riskLevel: "normal", feeEnvironment: "strong" })
).toBe("moderately_aggressive");
```

### Job wrappers for cron entrypoints

Jobs are single-line curry wrappers that give cron scripts a single import point:

```typescript
// src/jobs/jupiter-price-job.ts
export function jupiterPriceJob(deps: CollectJupiterPriceDeps): () => Promise<void> {
  return () => collectJupiterPrice(deps);
}
```

### Enforce boundaries with dependency-cruiser

8 rules in `.dependency-cruiser.cjs` enforce the layer contract at CI time:

- `domain-no-outbound` — domain may only import `contracts/snapshots`
- `domain-no-output-contracts` — domain cannot import `outputs` or `cron-config`
- `contracts-no-runtime` — contracts cannot import any runtime layer
- `ports-no-app-or-adapters` — ports are interfaces only
- `application-no-adapters-or-jobs` — use cases never touch infrastructure
- `jobs-no-adapters-or-domain-internals` — jobs delegate, don't reach through
- `adapters-no-app-or-jobs` — adapters only implement ports
- `inner-layers-no-node-builtins` — domain/application/ports/jobs/contracts stay portable

### exactOptionalPropertyTypes and conditional spreading

With `exactOptionalPropertyTypes: true`, you cannot pass `undefined` to an optional property. Use conditional spreading instead:

```typescript
currentRangeAssessment: {
  status: range.status,
  breachRisk: range.breachRisk,
  ...(position?.distanceToLowerPercent != null
    ? { distanceToLowerPercent: position.distanceToLowerPercent }
    : {}),
  ...(position?.distanceToUpperPercent != null
    ? { distanceToUpperPercent: position.distanceToUpperPercent }
    : {})
}
```

### .js extensions in all imports

NodeNext module resolution requires `.js` extensions in TypeScript imports:

```typescript
import type { HttpClient } from "../ports/http.js";
```

## Why This Matters

Layered separation with enforced boundaries produces three concrete benefits that the script-first architecture could not deliver:

1. **Domain tests need zero infrastructure.** The 7 domain test files import only domain functions and type imports. No fakes, no filesystem, no network. Tests run in milliseconds and never flake from I/O.

2. **Application tests use typed fakes instead of mocks.** Each fake implements a port interface with inspection methods (`.calls`, `.writes`). Tests assert on behavior, not implementation details.

3. **Boundary violations are caught at CI time.** dependency-cruiser's 8 rules prevent architectural drift. A domain module that accidentally imports from `application` or `adapters` fails the build. This eliminates the "just import it" temptation that erodes layer separation over time.

Without this structure, domain decisions were untestable in isolation, application logic required real HTTP/filesystem, and refactors had no guardrails against layer violations.

## When to Apply

- Building a pipeline, agent, or data-processing system where decision logic must be verified independently of infrastructure
- When test speed and reliability matter — pure domain tests and DI'd application tests eliminate I/O flakiness
- When the team grows beyond one contributor and informal "just don't import across layers" agreements erode
- When the same domain logic may need different infrastructure adapters (e.g., test fakes, local Node, cloud functions)
- When `exactOptionalPropertyTypes` is enabled in tsconfig and conditional spreading is needed for optional properties

## Examples

### Before: Script-first with mixed concerns

```
scripts/
  lib/price-fetcher.ts    # mixed HTTP + decision logic
  lib/pool-snapshot.ts    # mixed filesystem + decision logic
  daily-insight.ts        # script importing from lib/, no clear layer boundaries
```

Domain logic called `fetch()` directly, read files with `fs.readFileSync`, and used `Date.now()`. Tests required network stubs or were not written.

### After: Layered modular monolith

```
src/
  contracts/snapshots.ts     # typed input shapes (PriceSnapshot, PoolSnapshot, ...)
  contracts/outputs.ts       # typed output shapes (DailyInsight, RangeReview, ...)
  domain/daily-insight-decision.ts  # pure function, no I/O
  ports/http.ts               # interface: { getJson<T>(url, headers?): Promise<T> }
  application/collect-jupiter-price.ts  # orchestrates through ports
  jobs/jupiter-price-job.ts   # () => useCase(deps) curry wrapper
  adapters/node/fetch-http.ts         # implements HttpClient with fetch()
  adapters/node/composition-root.ts    # wires all adapters together
```

A domain function (`makeDailyInsightDecision`) takes typed snapshots and returns a typed decision — no ports, no I/O:

```typescript
export function makeDailyInsightDecision(inputs: DailyInsightInputs): DailyInsightDecision {
  const { quality, missing } = assessDataQuality(inputs);
  const range = assessRangeStatus(inputs.position);
  const feeEnvironment = classifyFeeEnvironment(inputs.pool);
  // ...pure decision logic, no await, no Date.now()
}
```

An application use case (`collectJupiterPrice`) orchestrates through ports:

```typescript
export async function collectJupiterPrice(deps: CollectJupiterPriceDeps): Promise<void> {
  const { http, jsonStore, env, clock } = deps;
  const response = await http.getJson<JupiterPriceResponse>(url);
  await jsonStore.writeJson(PRICE_SNAPSHOT_PATH, { ... });
}
```

The composition root wires everything at the script entrypoint:

```typescript
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

## Related

- Issue #2 (epic), #3 (this refactor), #4 (follow-on consumer), #14 (legacy removal)
- `docs/superpowers/specs/2026-05-10-int-arch-layered-monolith-design.md` (full design)
- `docs/superpowers/plans/2026-05-10-int-arch-layered-monolith.md` (execution plan)
- `docs/architecture.md` (current architecture summary)
- `.dependency-cruiser.cjs` (8 boundary rules enforcing layer separation)
