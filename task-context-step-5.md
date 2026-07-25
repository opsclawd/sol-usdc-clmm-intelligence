# Task Context: Task 5

Title: Document configure and operate the five-source core

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

- Modify: `.env.example`
- Modify: `resources/sources.yaml`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operator-runbook.md`

- [ ] **Step 1: Add operator-safe configuration**

  Add:

  ```dotenv
  SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
  SOLANA_RPC_API_KEY=
  ```

  Register `solana-rpc` in `resources/sources.yaml` as a high-priority deterministic RPC source for `network_status`, with 5-second timeout, two attempts, and limitations stating that it measures the configured endpoint rather than global consensus. Remove the old deterministic network-health deferment note while retaining the separate contextual protocol-incident source.

- [ ] **Step 2: Update architecture and runbook semantics**

  Change four-source diagrams/text to five sources and add Solana RPC alongside CLMM, Pyth, Jupiter, and Orca. Document:
  - `getHealth` and `getSlot` batch collection;
  - raw-first persistence for 2xx bodies;
  - `node_behind` and `slot_unavailable`;
  - two-attempt leaf-local retry behavior;
  - `COMPLETE` requiring five fresh usable outcomes;
  - a Solana-only outage producing `PARTIAL` when the other four are usable;
  - credential redaction and the configured-endpoint limitation;
  - troubleshooting for timeout, 408, 429, 5xx, malformed JSON-RPC, and `-32005`.

  Keep `solana-status-api` protocol incidents documented as contextual evidence so operators do not confuse it with live RPC health.

- [ ] **Step 3: Run task-scoped verification**

  ```bash
  git diff --check -- .env.example resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  pnpm exec prettier --check resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  sed -n '30,48p' .env.example
  sed -n '55,92p' resources/sources.yaml
  sed -n '258,310p' README.md
  sed -n '100,150p' docs/architecture.md
  sed -n '48,92p' docs/operator-runbook.md
  ```

  Expected: diff/prettier checks pass; the scoped excerpts show the two environment variables, five-source flow, status semantics, and no deferment claim or credential value.

- [ ] **Step 4: Commit**

  ```bash
  git add .env.example resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
  git commit -m "docs: operate five-source deterministic collection"
  ```

## Tests to add or update

- Add strict JSON-RPC batch validation tests in `tests/domain/network-status/solana-rpc.test.ts`.
- Add stable source identity tests in `tests/domain/network-status/identity.test.ts`.
- Add health/warning normalization tests in `tests/domain/network-status/normalize.test.ts`.
- Add freshness, confidence, and provenance tests in `tests/domain/network-status/enrich.test.ts`.
- Add raw-first, replay, conflict, retry, failure-classification, and credential-redaction tests in `tests/application/collect-solana-network-status.test.ts`.
- Update taxonomy registry/runtime parity tests for `network_status` and `solana-rpc`.
- Update core coordinator/reducer tests from four to five required leaves and add Solana partial-failure/conflict/warning-order cases.
- Update source-outcome tests for payload-warning mapping.
- Update core job/CLI tests for dependency binding, printed outcome, cleanup, and exit behavior.
- Existing CLMM, Pyth, Jupiter, Orca, shared ingestion, HTTP, and repository tests remain regression coverage and are not rewritten.

## Validation commands

The implement loop runs `pnpm -r typecheck` after every task. Task-specific commands are listed inside each task and operate only on files explicitly in that task. After all implementation tasks, the dedicated validation phase may run the repository’s standard aggregate checks:

```bash
pnpm verify
```

Expected: typecheck, lint, formatting, all Vitest suites, and dependency boundaries pass. This is not a standalone implementation task.

## Risk areas

- **Endpoint versus network truth:** one RPC node can be degraded while Solana remains healthy, or vice versa. Payload naming and docs must say “configured endpoint” and must not overclaim global consensus.
- **Raw-first malformed data:** a 2xx malformed batch must leave a failed raw row, while transport/non-2xx failures have no accepted body to normalize. Tests must distinguish these cases.
- **JSON-RPC correlation:** batch order is not stable. Correlating by array position can swap health and slot facts.
- **Retry multiplication:** only the Solana leaf retries, at most twice. Do not add coordinator retries or pass hidden retry counts into `postJsonRaw`.
- **Idempotency identity:** using response order, slot, payload hash, request id generation, or endpoint URL in `sourceObservationKey` would destabilize replay semantics.
- **Required-shape blast radius:** expanding `CoreSourceKey`, `CollectCoreDeps`, `CoreCollectionResult`, and `CoreCollectionJobDeps` must update every caller in Task 4.
- **Secret leakage:** hosted RPC URLs often contain credentials in paths or query strings. Metadata and diagnostics must never retain the full configured URL.
- **Taxonomy collision:** deterministic `network_status` must remain distinct from contextual `protocol_incident`.
- **Test-file size:** `tests/domain/taxonomy/registry.test.ts` exceeds 500 lines, but Task 1 is a contract/taxonomy implementation task, not a primary test-update task; modifications are explicitly restricted to parity data and one new describe block.

## Stop conditions

Abort implementation and report the blocker instead of continuing if any of these conditions is discovered:

- `SOLANA_RPC_URL` is intended to represent a quorum/fan-out provider contract rather than standard Solana JSON-RPC 2.0; that changes identity, payload, and health semantics.
- The target RPC does not support batched `getHealth` and `getSlot`, and choosing separate-request persistence semantics would require a product decision.
- The existing database schema or repository rejects the new taxonomy literals or JSON payload without a migration; schema work is outside this plan and must be replanned explicitly.
- A new port/interface method becomes necessary. Stop and revise the relevant task so the port change and every adapter/fake implementation remain atomic.
- The operator requires retention of literal HTTP wire bytes rather than the repository’s established canonical-JSON raw representation.
- Tests reveal that adding a fifth required core leaf would break a documented external consumer that cannot accept the additive `solana` result member.
- Safe diagnostics cannot be produced without exposing credential-bearing endpoint material.
- Implementing the source would require transaction submission, signing, wallet access, or any authority prohibited by `AGENTS.md`.

## Repository Targets

### Expected Files

- .env.example
- resources/sources.yaml
- README.md
- docs/architecture.md
- docs/operator-runbook.md

## Validation Commands

```bash
git diff --check -- .env.example resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
pnpm exec prettier --check resources/sources.yaml README.md docs/architecture.md docs/operator-runbook.md
sed -n '30,48p' .env.example
sed -n '55,92p' resources/sources.yaml
sed -n '258,310p' README.md
sed -n '100,150p' docs/architecture.md
sed -n '48,92p' docs/operator-runbook.md
```
