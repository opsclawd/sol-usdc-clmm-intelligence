# Task Context: Task 12

Title: Document feature semantics and operator usage

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-8
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-8
Start Commit: 5701491d28b2b8489db6ce45b5b24d87d3570a52

## Task Requirements

**Files:** Modify `README.md`, `docs/architecture.md`, and `docs/operator-runbook.md`.

- [ ] Document exactly seven feature kinds, units, scopes, calculator versions, deterministic-evidence role, authority boundary, and all deferred issue metrics.
- [ ] Document exact formulas, ties-away-from-zero rounding, one-hour volatility window/10-sample/45-minute/10-minute-gap rules, duplicate selection, confidence cap, expiry minimum, lineage, and derivation-key semantics.
- [ ] Document migration precondition, `WHIRLPOOL_ADDRESS`, `INTELLIGENCE_POSITION_IDS`, `INTELLIGENCE_CODE_VERSION`, `pnpm derive:mvp`, and examples of available/unavailable output.
- [ ] Run:

```bash
pnpm exec prettier --check README.md docs/architecture.md docs/operator-runbook.md
```

**Commit:** `docs: explain deterministic feature tranche`

**Tests to add or update**

- Contract/taxonomy tests cover exact kinds plus status/value, unit, scope, time, sorting, version, and provenance rules.
- Arithmetic/selector tests cover exact math, rounding, expiry, semantic ordering, duplicates, and bounded selection.
- Calculator tests cover golden values and explicit unavailable/partial outcomes for all seven features.
- Assembly/persistence tests cover confidence/freshness, complete lineage, canonical identity, migration safety, transactions, caller order, and replay.
- Application/script tests cover tranche cardinality/order, validate-before-write, configuration failures, and deterministic output.

**Validation commands**

- Each task’s exact commands are its acceptance criteria.
- After all implementation tasks, the orchestrator’s dedicated validation phase runs `pnpm verify`; this is intentionally not a standalone task.

**Risk areas**

- The migration must not reinterpret historical rows.
- Receipt-time candidate reads can be too narrow for semantic-time coverage or too broad for performance.
- Persisted `isStale` is only a snapshot; dynamic expiry must be re-evaluated.
- `Math.log` is floating point; versioned inputs, metadata, and final integer form the audit boundary.
- No-input unavailable identities must include scope/reasons to avoid collapsing unrelated failures.
- Conflict recovery must preserve transactional atomicity and caller order.
- Oracle confidence width, evidence confidence, and availability status are separate concepts.

**Stop conditions**

- Abort if any historical derived-feature row exists when applying the migration; do not backfill, relabel, or delete.
- Stop if normalized payloads do not match the assumed upstream contracts; revise the design instead of adding silent fallbacks.
- Stop if a port/interface step would leave any adapter, fake, or required-member consumer uncompilable.
- Stop before persistence if any assembled result fails `parseDerivedFeatureV1` or provenance validation; persist no partial tranche.
- Stop on transaction failure or conflict recovery that cannot recover every winning row in caller order.
- Stop if pool ID or explicit position IDs are missing; do not discover scope implicitly.
- Stop if the change expands into external collection, publication, policy synthesis, or execution authority.

## Repository Targets

### Expected Files

- README.md
- docs/architecture.md
- docs/operator-runbook.md

## Validation Commands

```bash
pnpm exec prettier --check README.md docs/architecture.md docs/operator-runbook.md
```
