# Task Context: Task 3

Title: Collect Solana status with raw-first persistence and bounded retries

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-7
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-7
Start Commit: d9bb76998401dd5a7d8096b1d4f98db221c3ed23

## Task Requirements

**Files:**

- Create: `src/application/collect-solana-network-status.ts`
- Create: `tests/application/collect-solana-network-status.test.ts`

**Behavioral invariants to test first:**

- `persists a 2xx response before validating and normalizing it`
- `marks a persisted malformed RPC batch failed without normalized rows`
- `replays identical network status without duplicate raw or normalized rows`
- `rejects a same-identity different-payload replay as conflict`
- `retries timeout network 408 429 and 5xx at most twice with the identical batch`
- `does not retry permanent 4xx or malformed successful bodies`
- `returns degraded usable evidence for node-behind or slot-unavailable status`
- `never exposes RPC credentials or credential-bearing paths in metadata or diagnostics`

- [ ] **Step 1: Write failing collector lifecycle tests**

  Build dependencies from `FakeHttp`, `FakeRetry`, `FakeEnv`, `FakeObservationRepo`, `FakeNormalizedObservationRepo`, and `FakeJsonStore`. Record repository event order. Use this exported surface:

  ```ts
  export interface CollectSolanaNetworkStatusDeps {
    readonly http: HttpClient;
    readonly retryControl: RetryControl;
    readonly jsonStore: JsonStore;
    readonly env: EnvReader;
    readonly rawObservationRepo: RawObservationRepo;
    readonly normalizedObservationRepo: NormalizedObservationRepo;
  }

  export interface SolanaNetworkStatusSourceResult {
    readonly status:
      | "accepted"
      | "identical_replay"
      | "degraded"
      | "timeout"
      | "network"
      | "unavailable"
      | "malformed"
      | "conflict"
      | "failed";
    readonly hasUsableEvidence: boolean;
    readonly rawObservationId: number | null;
    readonly normalizedCount: number;
    readonly warnings: readonly NetworkStatusWarning[];
    readonly freshness: Freshness | null;
    readonly confidenceLevel: ConfidenceLevel | null;
    readonly diagnostic: string | null;
  }

  export function collectSolanaNetworkStatus(
    deps: CollectSolanaNetworkStatusDeps,
    context: CollectionRunContext
  ): Promise<SolanaNetworkStatusSourceResult>;
  ```

  Run:

  ```bash
  pnpm test tests/application/collect-solana-network-status.test.ts
  ```

  Expected: FAIL because the collector does not exist.

- [ ] **Step 2: Implement the stable request and bounded retry loop**

  Read required `SOLANA_RPC_URL`, optional `SOLANA_RPC_API_KEY`, and optional `INTELLIGENCE_CODE_VERSION`. Construct one immutable request value:

  ```ts
  const request = [
    { jsonrpc: "2.0", id: "health", method: "getHealth" },
    { jsonrpc: "2.0", id: "slot", method: "getSlot", params: [{ commitment: "confirmed" }] }
  ] as const;
  ```

  Call `postJsonRaw` with `timeoutMs: 5_000` and a bearer header only when configured. Perform at most two total attempts. Retry thrown `HttpRequestError` values only when `retryable`, and retry response statuses 408, 429, or 5xx. Sleep once between attempts with the established bounded delay `25 + jitterUnit() * 25`. Permanent 4xx returns `unavailable`; exhausted timeout/network retains its specific status. Do not retry a 2xx body even when its JSON-RPC shape is malformed.

- [ ] **Step 3: Implement raw-first ingestion and outcome mapping**

  For a 2xx response, canonicalize `response.body`, derive the identity from mainnet plus `context.startedAtUnixMs`, and call `ingestRawObservation` before `acceptSolanaNetworkStatusBatch`. Persist request metadata containing only method `"POST"`, a sanitized host label, network, RPC method names, code version, and run id—never headers, API key, full URL, query, or path.

  The ingestion callbacks must:
  1. validate stored canonical JSON;
  2. normalize exactly one `NetworkStatusPayloadV1`;
  3. enrich exactly one deterministic observation;
  4. insert it through `NormalizedObservationRepo.insertMany`;
  5. mark the raw row parsed only after normalized insertion.

  On parsed replay, recover the linked normalized row with `findByRawObservation(rawId, "network_status")`. Map `behind` or any warning to usable `degraded`; a clean replay to `identical_replay`; `RawObservationConflictError` to `conflict`; validation failure after insertion to `malformed` with the durable raw id; and unexpected persistence/enrichment failure to `failed`. Diagnostics must use stable redacted messages rather than echoing the configured URL or headers.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/application/collect-solana-network-status.test.ts
  pnpm exec eslint src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts --max-warnings 0
  pnpm exec prettier --check src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts
  ```

  Expected: all commands pass. The implement loop’s automatic `pnpm -r typecheck` gate also passes after this task.

- [ ] **Step 5: Commit**

  ```bash
  git add src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts
  git commit -m "feat: ingest Solana RPC status raw first"
  ```

## Repository Targets

### Expected Files

- src/application/collect-solana-network-status.ts
- tests/application/collect-solana-network-status.test.ts

## Validation Commands

```bash
pnpm test tests/application/collect-solana-network-status.test.ts
pnpm exec eslint src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts --max-warnings 0
pnpm exec prettier --check src/application/collect-solana-network-status.ts tests/application/collect-solana-network-status.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **raw before normalized**: A successful HTTP body is durably inserted before validation, normalization, and parsed status. (Test: `persists a 2xx response before validating and normalizing it`)
- **malformed raw auditability**: Malformed 2xx data leaves a failed raw row and creates no normalized observation. (Test: `marks a persisted malformed RPC batch failed without normalized rows`)
- **identical replay idempotency**: An identical parsed replay returns linked evidence without duplicate raw or normalized rows. (Test: `replays identical network status without duplicate raw or normalized rows`)
- **conflicting replay fails closed**: The same source identity with different content is a conflict and never overwrites evidence. (Test: `rejects a same-identity different-payload replay as conflict`)
- **bounded retry transition**: Retryable transport/status failures transition to one retry with the identical request, then success or terminal failure. (Test: `retries timeout network 408 429 and 5xx at most twice with the identical batch`)
- **non-retryable terminal transition**: Permanent 4xx and malformed 2xx bodies stop without a second HTTP attempt. (Test: `does not retry permanent 4xx or malformed successful bodies`)
- **degraded evidence remains usable**: Behind health or missing slot maps to degraded usable evidence with explicit warnings. (Test: `returns degraded usable evidence for node-behind or slot-unavailable status`)
- **credential-safe audit trail**: Metadata and diagnostics omit authorization values and credential-bearing endpoint paths. (Test: `never exposes RPC credentials or credential-bearing paths in metadata or diagnostics`)
