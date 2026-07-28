# Task Context: Task 2

Title: Align compatibility and aggregate price-flow coverage

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-46
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-46
Start Commit: d87ebdc604dcc68dd3d0e5b3fc624a615ebef6ab

## Task Requirements

**Files:**

- Modify: `tests/application/collect-jupiter-price.test.ts:8-70`
- Modify: `tests/application/collect-price-observations.test.ts:19-220`
- Reference: `src/application/collect-jupiter-price.ts:1-55`
- Reference: `src/application/collect-price-observations.ts:1-135`

**Named invariant tests to write first:**

- `delegates to the Jupiter Lite v1 quote endpoint and writes compatibility snapshot` — proves the compatibility wrapper reaches Lite v1 and preserves its snapshot behavior.
- `collects accepted Pyth and Jupiter Lite v1 observations together` — proves the aggregate flow reaches Lite v1 and still accepts both price sources.

- [ ] **Step 1: Tighten the compatibility-wrapper test before changing its fixture**

Rename `delegates to collectJupiterQuote and writes compatibility snapshot` to `delegates to the Jupiter Lite v1 quote endpoint and writes compatibility snapshot`. After invoking `collectJupiterPrice`, add:

```ts
expect(deps.http.calls[0]?.url).toBe(url);
expect(deps.http.calls[0]?.url).toMatch(/^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
```

- [ ] **Step 2: Tighten the aggregate success test before changing its fixture**

Rename `covers both usable success, parsed replay usability, deterministic warning ordering, and null/omitted missing fields rather than zeros` to `collects accepted Pyth and Jupiter Lite v1 observations together`. After the first `collectPriceObservations` call, add:

```ts
expect(deps.http.calls.map((call) => call.url)).toContain(jupUrl);
expect(jupUrl).toMatch(/^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
```

Retain all existing assertions in that test, including replay usability and missing-field behavior; the narrower name identifies the endpoint invariant added by this migration without removing prior coverage.

- [ ] **Step 3: Run both named tests and verify they detect the retired fixtures**

Run:

```bash
pnpm exec vitest run tests/application/collect-jupiter-price.test.ts -t "delegates to the Jupiter Lite v1 quote endpoint and writes compatibility snapshot"
pnpm exec vitest run tests/application/collect-price-observations.test.ts -t "collects accepted Pyth and Jupiter Lite v1 observations together"
```

Expected: both commands FAIL their Lite endpoint assertions while their shared constants still use `https://api.jup.ag/swap/v6`.

- [ ] **Step 4: Migrate the downstream test fixtures**

In both test files, replace only the shared base constant with:

```ts
const JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1";
```

Leave query construction and all non-Jupiter fixtures unchanged.

- [ ] **Step 5: Run task-scoped checks**

Run:

```bash
pnpm exec vitest run tests/application/collect-jupiter-price.test.ts tests/application/collect-price-observations.test.ts
pnpm exec eslint tests/application/collect-jupiter-price.test.ts tests/application/collect-price-observations.test.ts
pnpm exec prettier --check tests/application/collect-jupiter-price.test.ts tests/application/collect-price-observations.test.ts
sed -n '1,70p' tests/application/collect-jupiter-price.test.ts
sed -n '15,40p' tests/application/collect-price-observations.test.ts
sed -n '196,225p' tests/application/collect-price-observations.test.ts
```

Expected: both Vitest files pass; ESLint and Prettier exit 0; the scoped excerpts show only the Lite v1 base and the two named endpoint assertions.

- [ ] **Step 6: Commit downstream regression coverage**

```bash
git add tests/application/collect-jupiter-price.test.ts tests/application/collect-price-observations.test.ts
git commit -m "test: cover Jupiter Lite endpoint delegation"
```

**Controlled live acceptance**

This is not a separate implementation task. Run it only after both tasks, from an environment with an explicitly approved disposable or operational `intelligence` database target and the normal collector variables configured. The command persists raw and normalized observations, so do not run it when the database target is unknown.

First verify the public endpoint and required response fields without persistence:

```bash
curl --fail-with-body --silent --show-error 'https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true' | pnpm exec tsx -e 'let raw=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",(chunk)=>raw+=chunk); process.stdin.on("end",()=>{const quote=JSON.parse(raw); for (const key of ["inputMint","inAmount","outputMint","outAmount","swapMode","routePlan","contextSlot"]) if (!(key in quote)) throw new Error(`missing ${key}`); if (!Array.isArray(quote.routePlan) || quote.routePlan.length === 0) throw new Error("routePlan is empty"); console.log("Jupiter Lite quote shape OK");});'
```

Expected: exit 0 and print `Jupiter Lite quote shape OK`.

Then exercise the repository collector with the migrated base:

```bash
JUPITER_API_BASE=https://lite-api.jup.ag/swap/v1 pnpm collect:price
```

Expected: the JSON output contains a Jupiter outcome with `"status": "accepted"` or `"status": "identical_replay"` and no Jupiter 404/unavailable diagnostic. A Pyth failure may make the overall flow partial, but it must not mask inspection of the Jupiter outcome.

**Risk areas**

- The live Lite response may diverge from the unusually strict existing `JupiterQuoteSchema`; a 200 response alone does not prove collector compatibility.
- Existing deployments retain their local `JUPITER_API_BASE`; changing `.env.example` cannot migrate those values automatically.
- The Lite host may have different API-key or rate-limit policies even if the response schema is compatible.
- `pnpm collect:price` also contacts Pyth and writes database rows. Those external dependencies can fail independently of this endpoint migration.
- Reusing an identical live quote can legitimately produce `identical_replay`, which is an accepted usable outcome rather than a migration failure.

**Stop conditions**

- Abort the configuration-only implementation if the Lite endpoint is unavailable, redirects to a materially different contract, returns no route for the canonical SOL/USDC request, or omits any field required by `JupiterQuoteSchema`; update the design before changing source/schema code.
- Abort if endpoint migration requires changes to query semantics, authentication headers, retry behavior, normalized contracts, or exported signatures; those changes exceed this plan.
- Do not run the controlled live collector when `DATABASE_URL` or its target schema cannot be positively identified and approved.
- Stop and investigate rather than broadening scope if the task-scoped unit tests fail for behavior unrelated to the URL or metadata-host changes.
- Preserve any pre-existing user changes that overlap the five affected files; stop if they cannot be cleanly reconciled.

**Validation summary**

- Task 1 acceptance: `.env.example`, the operator runbook, and the leaf collector test agree on `https://lite-api.jup.ag/swap/v1`; the leaf test proves exact request construction and redacted host metadata.
- Task 2 acceptance: compatibility and aggregate tests use and explicitly assert the same Lite v1 endpoint while retaining their existing success, replay, and failure coverage.
- Controlled live acceptance: the canonical public request has the required shape, and `pnpm collect:price` reports Jupiter as accepted or identically replayed against an approved database target.
- No source file, schema, port/interface, or exported API declaration is modified.

## Repository Targets

### Expected Files

- tests/application/collect-jupiter-price.test.ts
- tests/application/collect-price-observations.test.ts

### Reference Files

- src/application/collect-jupiter-price.ts
- src/application/collect-price-observations.ts

## Validation Commands

```bash
pnpm exec vitest run tests/application/collect-jupiter-price.test.ts tests/application/collect-price-observations.test.ts
["pnpm","exec","eslint","tests/application/collect-jupiter-price.test.ts","tests/application/collect-price-observations.test.ts"]
["pnpm","exec","prettier","--check","tests/application/collect-jupiter-price.test.ts","tests/application/collect-price-observations.test.ts"]
sed -n '1,70p' tests/application/collect-jupiter-price.test.ts
sed -n '15,40p' tests/application/collect-price-observations.test.ts
sed -n '196,225p' tests/application/collect-price-observations.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **compatibility wrapper Lite endpoint delegation**: The deprecated compatibility wrapper delegates to collectJupiterQuote, reaches the Lite v1 quote endpoint, and preserves compatibility snapshot behavior. (Test: `delegates to the Jupiter Lite v1 quote endpoint and writes compatibility snapshot`)
- **aggregate Lite endpoint delegation**: The aggregate price flow reaches the Lite v1 quote endpoint while continuing to accept concurrent Pyth and Jupiter observations. (Test: `collects accepted Pyth and Jupiter Lite v1 observations together`)
