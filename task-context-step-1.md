# Task Context: Task 1

Title: Add canonical perp contracts and taxonomy policies

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-11
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-11
Start Commit: d62ccad6f3f1f0812dc1d59b322256f63fbcf7ba

## Task Requirements

**Files:**

- Create: `src/contracts/perp-liquidation.ts`
- Create: `tests/contracts/perp-liquidation.test.ts`
- Create: `tests/fixtures/perp-liquidation.ts`
- Modify: `src/contracts/taxonomy.ts`
- Modify: `src/contracts/derived-feature.ts`
- Modify: `src/contracts/index.ts`
- Modify: `src/domain/taxonomy/registry.ts`
- Modify: `src/domain/evidence-bundle/assemble.ts`
- Modify: `src/domain/evidence-bundle/quality.ts`
- Modify: `src/domain/evidence-bundle/select.ts`
- Modify: `src/application/assemble-evidence-bundle.ts`
- Modify: `tests/domain/taxonomy/registry.test.ts` (only the canonical kind arrays and a new `perp_liquidation policies` describe block)

- [ ] **Step 1: Write failing contract and registry tests**

  Test discriminated payloads for all five observation kinds, signed decimal funding, positive decimal amounts/prices, long/short liquidation side, canonical source names, and metric coverage. Add the new kinds to the existing exhaustive registry arrays and add:

  ```ts
  it("registers ephemeral perp facts as degrade-on-stale evidence", () => {
    for (const kind of [
      "funding_rate",
      "open_interest",
      "perp_basis",
      "liquidation_event",
      "leverage_proxy"
    ] as const) {
      const entry = getObservationKindEntry(kind);
      expect(entry.evidenceFamily).toBe("perp_liquidation");
      expect(entry.freshnessPolicy.staleBehavior).toBe("degrade_confidence");
      expect(entry.provenanceRequirements.allowedSourceRefs).toEqual(["binance-fapi", "drift-api"]);
    }
  });
  ```

- [ ] **Step 2: Verify the tests fail for absent kinds and contracts**

  Run: `pnpm vitest run tests/contracts/perp-liquidation.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: FAIL because the new contract and registry entries do not exist.

- [ ] **Step 3: Define venue-neutral contracts and taxonomy members**

  Add `binance-fapi` and `drift-api` to `Source`; add the five observation kinds and four feature kinds requested by the design to `FeatureKind` and `MVP_FEATURE_KINDS`. Also update exhaustive `FeatureKind` handling in evidence-bundle helpers (`src/domain/evidence-bundle/*.ts` and `src/application/assemble-evidence-bundle.ts`) so typecheck passes. Define this core shape and discriminated payloads:

  ```ts
  export type PerpVenue = "binance-fapi" | "drift-api";
  export type PerpMetricKind =
    | "funding_rate"
    | "open_interest"
    | "perp_basis"
    | "liquidation_event"
    | "leverage_proxy";

  export interface PerpObservationBaseV1 {
    readonly schemaVersion: 1;
    readonly evidenceFamily: "perp_liquidation";
    readonly pair: "SOL/USDC";
    readonly venue: PerpVenue;
    readonly instrument: string;
    readonly sourceEventId: string;
    readonly observedAtUnixMs: number;
  }

  export type PerpObservationPayloadV1 =
    | FundingRatePayloadV1
    | OpenInterestPayloadV1
    | PerpBasisPayloadV1
    | LiquidationEventPayloadV1
    | LeverageProxyPayloadV1;
  ```

  Use decimal strings for `fundingRate`, `openInterestBase`, `openInterestUsdc`, `perpPriceUsdc`, `spotPriceUsdc`, `amountBase`, `notionalUsdc`, and `longShortRatio`. Funding includes `fundingIntervalHours`; OI includes the provider sample window; basis includes both prices; liquidation includes `side`; leverage includes `methodology: "global_account_long_short_ratio" | "market_net_position_ratio"`. Coverage records must distinguish `available`, `unavailable`, and `malformed` with a diagnostic.

- [ ] **Step 4: Register freshness, confidence, and provenance policies**

  Register all observation and feature kinds as deterministic `perp_liquidation` evidence. Use 15-minute maximum age for funding, OI, basis, and leverage; 60 minutes for individual liquidation events; four hours for `oi_trend_4h`; one hour for `liquidation_cluster_1h`; and 15 minutes for annualized funding and basis. All use `degrade_confidence`, allow both approved sources, and use the existing deterministic confidence weighting pattern.

- [ ] **Step 5: Run focused tests and formatting**

  Run: `pnpm vitest run tests/contracts/perp-liquidation.test.ts tests/domain/taxonomy/registry.test.ts`

  Expected: PASS.

  Run: `pnpm exec eslint src/contracts/perp-liquidation.ts src/contracts/taxonomy.ts src/contracts/derived-feature.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/perp-liquidation.test.ts tests/fixtures/perp-liquidation.ts tests/domain/taxonomy/registry.test.ts`

  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/contracts/perp-liquidation.ts src/contracts/taxonomy.ts src/contracts/derived-feature.ts src/contracts/index.ts src/domain/taxonomy/registry.ts src/domain/evidence-bundle src/application/assemble-evidence-bundle.ts tests/contracts/perp-liquidation.test.ts tests/fixtures/perp-liquidation.ts tests/domain/taxonomy/registry.test.ts
  git commit -m "feat: define perp liquidation evidence taxonomy"
  ```

## Repository Targets

### Expected Files

- src/contracts/perp-liquidation.ts
- tests/contracts/perp-liquidation.test.ts
- tests/fixtures/perp-liquidation.ts
- src/contracts/taxonomy.ts
- src/contracts/derived-feature.ts
- src/contracts/index.ts
- src/domain/taxonomy/registry.ts
- src/domain/evidence-bundle/assemble.ts
- src/domain/evidence-bundle/quality.ts
- src/domain/evidence-bundle/select.ts
- src/application/assemble-evidence-bundle.ts
- tests/domain/taxonomy/registry.test.ts
- tests/domain/evidence-bundle/assemble.test.ts
- tests/domain/evidence-bundle/context-events-assemble.test.ts
- tests/domain/evidence-bundle/quality.test.ts
- tests/domain/evidence-bundle/select.test.ts

## Validation Commands

```bash
pnpm vitest run tests/contracts/perp-liquidation.test.ts tests/domain/taxonomy/registry.test.ts tests/domain/evidence-bundle/assemble.test.ts tests/domain/evidence-bundle/context-events-assemble.test.ts tests/domain/evidence-bundle/quality.test.ts tests/domain/evidence-bundle/select.test.ts
pnpm exec eslint src/contracts/perp-liquidation.ts src/contracts/taxonomy.ts src/contracts/derived-feature.ts src/contracts/index.ts src/domain/taxonomy/registry.ts tests/contracts/perp-liquidation.test.ts tests/fixtures/perp-liquidation.ts tests/domain/taxonomy/registry.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **ephemeral perp facts degrade on stale input**: Every Pack C observation and feature uses the perp_liquidation family and degrade_confidence stale behavior. (Test: `registers ephemeral perp facts as degrade-on-stale evidence`)
