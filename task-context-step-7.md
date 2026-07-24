# Task Context: Task 7

Title: Add CLI configuration and operator documentation

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-10
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-10
Start Commit: dfdc6c6a72b0862f77922bc0061053324d906eef

## Task Requirements

**Files:**

- Create: `scripts/collectors/on-chain-flow.ts`
- Modify: `package.json`
- Modify: `resources/sources.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`
- Create: `tests/scripts/on-chain-flow.test.ts`

**Behavioral invariants to test first:**

- `missing provider URL or API key fails before opening persistence`.
- `invalid negative non-decimal or unsafe threshold fails before HTTP and persistence`.
- `configured values create both adapters and pass explicit thresholds to the job`.
- `COMPLETE and PARTIAL exit zero while UNAVAILABLE and FAILED exit nonzero`.
- `provider keys are redacted from logs and close failures`.
- `database connection closes exactly once after a started run`.

- [ ] **Step 1: Write failing CLI tests**

  Test exported `runOnChainFlowCollect` through injected runtime/adapter/job factories rather than mutating real environment or opening a DB.

  Run:

  ```bash
  pnpm test tests/scripts/on-chain-flow.test.ts
  ```

  Expected: FAIL because the entrypoint does not exist.

- [ ] **Step 2: Implement the thin CLI and package command**

  Add `"collect:on-chain-flow": "tsx scripts/collectors/on-chain-flow.ts"` to `package.json`. Read and validate:

  ```text
  HELIUS_FLOW_API_URL
  HELIUS_API_KEY
  BIRDEYE_FLOW_API_URL
  BIRDEYE_API_KEY
  ON_CHAIN_WHALE_TRANSFER_MIN_USDC
  ON_CHAIN_WHALE_SWAP_MIN_USDC
  ON_CHAIN_STABLECOIN_FLOW_MIN_USDC
  ON_CHAIN_DEX_NET_FLOW_MIN_USDC
  ON_CHAIN_CEX_PROXY_MIN_USDC
  ON_CHAIN_CEX_MIN_ATTRIBUTION_CONFIDENCE
  ON_CHAIN_FLOW_LOOKBACK_MS
  ```

  Defaults: `1000000` for transaction/stablecoin/CEX thresholds, `5000000` for DEX net flow, `0.8` attribution confidence, and `900000` lookback. Instantiate both adapters, obtain persistence only after configuration validation, call `runOnChainFlowJob`, print secret-redacted JSON, map status to exit code, and close the connection in `finally`.

- [ ] **Step 3: Document source policy and operations**

  Add both sources to `resources/sources.yaml`, including authentication variables, purpose/kind allowlists, timeout/retry policy, bounded-retention requirement, attribution limitations, and threshold variables. Add architecture and runbook sections covering:
  - factual-vs-motive authority boundary;
  - per-event raw-first flow and stable identities;
  - threshold defaults and exact decimal semantics;
  - CEX proxy confidence/noise behavior;
  - environment variables, command, statuses, troubleshooting, retention, and no-event semantics.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/scripts/on-chain-flow.test.ts
  pnpm exec eslint scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts --max-warnings 0
  pnpm exec prettier --check scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts package.json resources/sources.yaml docs/architecture.md docs/operator-runbook.md
  ```

  Expected: all commands pass and documentation names every configured variable.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/collectors/on-chain-flow.ts package.json resources/sources.yaml docs/architecture.md docs/operator-runbook.md tests/scripts/on-chain-flow.test.ts
  git commit -m "feat: expose on-chain flow collector command"
  ```

**Tests added or updated**

- Contract/taxonomy: payload discriminants, required factual metadata, source allowlists, signal classes, freshness, and confidence policy.
- Adapter: provider mapping, empty response, malformed response, retry/no-retry behavior, kind allowlists, and secret redaction.
- Pure domain: strict validation, exact decimal threshold boundaries, factual normalization, DEX arithmetic, CEX quality gates, identity stability, freshness, provenance, and confidence caps.
- Application: large event, duplicate, conflict, below-threshold, malformed-only, partial persistence, no-event, stale, and low-quality CEX cases.
- Job: complete/partial/unavailable/failed reduction, duplicate configuration, shared run context, and deterministic ordering.
- CLI: configuration validation, dependency wiring, exit codes, secret redaction, and connection lifecycle.

**Validation commands**

Each task contains file-scoped acceptance commands. After all implementation tasks, the orchestrator’s dedicated validate phase may run the repository-standard gate:

```bash
pnpm verify
```

This is not an implementation task and must not be converted into one.

**Risk areas**

- Commercial provider payloads may differ from the bounded envelope assumed here; do not weaken validation to accommodate undocumented fields.
- Decimal threshold and signed net-flow arithmetic can silently lose precision if converted to JavaScript `number`.
- Transaction identity must distinguish multiple events in one signature without including pagination/run metadata.
- Per-event persistence intentionally permits partial success; status reduction must never report `COMPLETE` after a failed qualifying event.
- CEX address attribution can be stale or wrong; its explicit quality gate and confidence cap are an authority boundary, not presentation metadata.
- Retrying at both `HttpClient` and adapter layers can multiply attempts; adapters must call the client with `maxAttempts: 1`.
- Provider responses can be large; adapters must preserve bounded extracts and the configured time window rather than retaining arbitrary transaction bodies.
- DB writes are durable and append-only. Tests must prove validation/thresholding happens before insertion and conflicts never overwrite rows.

**Stop conditions**

- Abort if Helius or Birdeye cannot contractually supply stable event IDs/signatures, source timestamps, non-empty source references, or bounded-retention/license permission.
- Abort if the actual provider contract cannot distinguish transaction facts from provider interpretation, or cannot expose the attribution confidence needed for defensible CEX proxies.
- Abort if DEX buy/sell pressure cannot be denominated consistently in USDC or reconciled exactly to the signed net value.
- Abort if implementation would require mutating existing raw/normalized observations, changing DB uniqueness constraints, or bypassing `ingestRawObservation`; revise the design first.
- Abort if a requested change would publish policy, infer motive, create transactions, or cross the regime-engine authority boundary.
- Abort and split the provider into a follow-up issue if API pagination/backfill is required to meet basic collection; this plan deliberately covers one bounded window per run.

**Completion criteria**

- Every qualifying accepted event has an immutable raw row and a separately persisted normalized row with amount, direction, venue/address context, source refs, freshness, provenance, and confidence.
- Exact replays create no duplicates, changed payloads under the same chain identity conflict, and below-threshold/malformed events create no raw rows.
- All five required flow kinds are represented, with DEX pressure sourced from Birdeye and transaction flows sourced from Helius.
- CEX proxies remain probabilistic and visibly noisy; no output claims motive or policy.
- The new command, configuration, source policy, and operator behavior are documented and all task-scoped tests pass.

## Repository Targets

### Expected Files

- scripts/collectors/on-chain-flow.ts
- package.json
- resources/sources.yaml
- docs/architecture.md
- docs/operator-runbook.md
- tests/scripts/on-chain-flow.test.ts

## Validation Commands

```bash
pnpm test tests/scripts/on-chain-flow.test.ts
pnpm exec eslint scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts --max-warnings 0
pnpm exec prettier --check scripts/collectors/on-chain-flow.ts tests/scripts/on-chain-flow.test.ts package.json resources/sources.yaml docs/architecture.md docs/operator-runbook.md
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **configuration before resources**: Missing provider configuration fails before persistence is opened. (Test: `missing provider URL or API key fails before opening persistence`)
- **threshold validation before effects**: Invalid thresholds fail before HTTP or DB side effects. (Test: `invalid negative non-decimal or unsafe threshold fails before HTTP and persistence`)
- **explicit wiring**: Validated environment values construct both adapters and an explicit threshold set. (Test: `configured values create both adapters and pass explicit thresholds to the job`)
- **exit status mapping**: COMPLETE/PARTIAL exit zero and UNAVAILABLE/FAILED exit nonzero. (Test: `COMPLETE and PARTIAL exit zero while UNAVAILABLE and FAILED exit nonzero`)
- **CLI secret redaction**: Logs and close diagnostics cannot disclose provider keys. (Test: `provider keys are redacted from logs and close failures`)
- **connection finalization**: A started run closes its DB connection exactly once. (Test: `database connection closes exactly once after a started run`)
