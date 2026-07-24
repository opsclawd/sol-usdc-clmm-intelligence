# Task Context: Task 4

Title: Derive stable identities and enrich normalized observations

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

- Create: `src/domain/on-chain-flow/identity.ts`
- Create: `src/domain/on-chain-flow/enrich.ts`
- Modify: `src/domain/on-chain-flow/index.ts`
- Create: `tests/domain/on-chain-flow/identity.test.ts`
- Create: `tests/domain/on-chain-flow/enrich.test.ts`

**Behavioral invariants to test first:**

- `transaction identity is stable across pagination and collection runs`: only source, kind, signature, and event index affect the source observation key.
- `different events in one transaction have different identities`: event index or kind changes the key.
- `DEX window identity changes when venue or window bounds change`: separate pressure windows cannot collide.
- `enrichment computes freshness from source time and retrieval time`: expired data is marked stale under the taxonomy policy.
- `enrichment validates raw-first provenance`: source/raw refs point to the actual raw row and allowed provider.
- `CEX confidence is capped by attribution quality and records the cap reason`: high generic provider quality cannot erase proxy uncertainty.
- `non-CEX confidence does not receive the CEX cap`: deterministic facts retain ordinary component weighting.

- [ ] **Step 1: Write failing identity and enrichment tests**

  Run:

  ```bash
  pnpm test tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  ```

  Expected: FAIL because the identity and enrichment modules do not exist.

- [ ] **Step 2: Implement stable identity**

  Export `deriveOnChainFlowObservationKey`. Canonicalize the relevant identity tuple and hash it. Explicitly exclude provider run ID, pagination cursor, fetched time, and payload hash from transaction identity so retries do not duplicate the same chain event. Use window bounds for DEX observations, which have no transaction signature.

- [ ] **Step 3: Implement enrichment**

  Export `enrichOnChainFlow`. Canonicalize the normalized payload, load its taxonomy entry, compute freshness and confidence, build/validate provenance, and return the fields needed by `NormalizedObservationInsert`. Compute completeness from required context availability. For CEX proxy, cap `sourceReliability` at `attributionConfidence`, cap final composite confidence at `0.69`, force at most `medium`, and append `cex_proxy_quality_cap_applied` when a cap changes the result.

- [ ] **Step 4: Run task-scoped verification**

  ```bash
  pnpm test tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  pnpm exec eslint src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts --max-warnings 0
  pnpm exec prettier --check src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
  git commit -m "feat: identify and enrich on-chain flow observations"
  ```

## Repository Targets

### Expected Files

- src/domain/on-chain-flow/identity.ts
- src/domain/on-chain-flow/enrich.ts
- src/domain/on-chain-flow/index.ts
- tests/domain/on-chain-flow/identity.test.ts
- tests/domain/on-chain-flow/enrich.test.ts

## Validation Commands

```bash
pnpm test tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
pnpm exec eslint src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts --max-warnings 0
pnpm exec prettier --check src/domain/on-chain-flow/identity.ts src/domain/on-chain-flow/enrich.ts src/domain/on-chain-flow/index.ts tests/domain/on-chain-flow/identity.test.ts tests/domain/on-chain-flow/enrich.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **transaction replay identity**: Pagination and run metadata cannot change a transaction event identity. (Test: `transaction identity is stable across pagination and collection runs`)
- **multi-event uniqueness**: Different indexes or kinds within one transaction produce different identities. (Test: `different events in one transaction have different identities`)
- **window uniqueness**: DEX venue or time-window changes produce a new identity. (Test: `DEX window identity changes when venue or window bounds change`)
- **freshness derivation**: Freshness uses the source observation and retrieval timestamps under taxonomy policy. (Test: `enrichment computes freshness from source time and retrieval time`)
- **raw-first provenance**: Normalized provenance references the actual raw row and an allowed source. (Test: `enrichment validates raw-first provenance`)
- **CEX confidence cap**: CEX attribution quality caps confidence and records why. (Test: `CEX confidence is capped by attribution quality and records the cap reason`)
- **non-CEX confidence**: Deterministic non-CEX facts do not receive the proxy-only cap. (Test: `non-CEX confidence does not receive the CEX cap`)
