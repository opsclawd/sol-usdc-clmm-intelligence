# INT-ARCH Layered Monolith Design

**Date:** 2026-05-10
**Status:** Approved for planning
**Issue:** https://github.com/opsclawd/sol-usdc-clmm-intelligence/issues/3

## Purpose

Refactor this repo in place from a script-first OpenClaw artifact pipeline into a layered modular monolith. The goal is to make `src/` the code authority, preserve the current external command and artifact surface, and prevent future intelligence-pipeline work from becoming a collection of scripts coupled through implicit file state.

This issue is architectural foundation only. It does not introduce evidence-bundle contracts, DB persistence, new collectors, Regime Engine publishing, or dual legacy/new output flows.

## Architecture

The design will make `src/` the code authority while preserving the existing repo contract.

`src/domain` owns pure decision logic used by the current advisory flows: range assessment, fee classification, data-quality classification, posture/range-bias decisions, and pure advisory-policy rules. It has no filesystem, HTTP, environment, process, or clock dependencies.

`src/application` owns use cases that match today's behavior: collect backend snapshots, collect Jupiter price, generate daily insight, generate range review, generate weekly review, render cron commands, and sync cron jobs. These use cases coordinate ports and domain functions but do not directly call `fetch`, read files, write files, access environment variables, inspect `process`, or spawn commands.

`src/ports` defines dependency interfaces for HTTP, JSON file storage, environment config, command execution needed for cron sync, and clock/time. `src/adapters` implements those ports for Node.

`src/jobs` owns scheduled workflow composition for cron-driven execution. It wires scheduled jobs to application use cases but contains no domain logic and no infrastructure implementation. For the current cron helpers, jobs are orchestration wrappers around application cron use cases rather than a separate scheduling engine.

`src/contracts` holds TypeScript types for current snapshot/output shapes, while top-level `schemas/` remains the existing JSON Schema asset directory.

`scripts/*` remain thin entrypoints: parse CLI flags where needed, build Node adapters, call one application use case or job, print output, and set `process.exitCode` on failure. Current package scripts, output paths, and JSON behavior stay stable.

The no-execution boundary remains invariant: this repo may produce advisory artifacts only and must not sign, submit, rebalance, swap, or otherwise perform wallet execution.

## Data Flow

`src/jobs` may orchestrate scheduled workflows, but Node composition still happens outside it. `scripts/openclaw/*` build the Node adapters and call a cron job or use case, while `src/jobs` receives ports and stays free of `process`, `spawn`, filesystem APIs, and adapter imports.

For data flow, every existing command keeps the same behavior:

```text
script entrypoint
  -> Node composition root
  -> application use case or job
  -> domain logic + port calls
```

Node adapters implement those ports at runtime. The Node composition factory lives with the Node adapters, creates concrete port implementations, and does not call application use cases by itself.

Collectors use environment and HTTP adapters, then write the same `data/latest-*.json` files. Generator use cases read the same legacy snapshot files, run domain assessment functions, assemble the same legacy output contracts, write the same `outputs/*.json` files, and return the payload for console printing.

Cron render and sync use cases read `cron/jobs.yaml` and routine files through ports, build the same OpenClaw commands, and preserve the current dry-run and `--apply` behavior. `cron:sync -- --apply` remains the only path that invokes `openclaw`.

## Boundary Rules

Boundary rules will be automated with `dependency-cruiser`:

- `domain` may import domain-local modules and narrow input fact types from `contracts`; it must not import generated-output contracts, ports, application, jobs, adapters, scripts, or runtime infrastructure.
- `contracts` may import only other contract modules and validation/type utilities; they may not import runtime application, domain, job, or adapter code.
- `ports` may import `domain` and `contracts`, but not `application`, `jobs`, `adapters`, or `scripts`.
- `application` may import `domain`, `ports`, and `contracts`, but not `jobs`, `adapters`, or `scripts`.
- `jobs` may import `application`, `ports`, and `contracts`, but not `adapters`, `scripts`, or domain internals directly.
- `adapters` may import `ports`, `contracts`, and required Node/external libraries, but not `application`, `jobs`, or `scripts`.
- `scripts` may import the Node composition factory plus the specific application use case or job they invoke.

Inner layers (`domain`, `contracts`, `ports`, `application`, `jobs`) may not import Node built-ins, direct environment/process access, or concrete adapter modules.

## Error Handling

Use cases preserve today's failure semantics but make them explicit. Collector failure semantics remain command-specific: backend snapshot collection preserves per-source `Promise.allSettled` behavior, while single-source collectors preserve fail-fast behavior. Entrypoints remain responsible for printing failures and setting nonzero exit codes.

Generator use cases preserve current conservative advisory behavior under incomplete inputs: missing snapshots continue to drive the existing partial/stale data-quality outcomes and the existing derived actions such as `watch`, `hold`, or `pause_rebalances`, while preserving `requiresHumanApproval` semantics and `executionPermittedByAgent: false`.

Cron rendering and syncing separate pure command construction from side effects. Command-building logic is testable without spawning `openclaw`; applying cron jobs goes through a command-runner port and remains gated by `--apply`.

## Testing

Testing focuses on moved behavior rather than broad new infrastructure.

Add domain unit tests for:

- range status
- fee classification
- data quality
- advisory-policy assembly

Add application/job tests with fake ports for:

- daily insight generation
- range review generation
- weekly review generation
- backend snapshot collection
- Jupiter price collection
- cron command rendering
- cron sync behavior

Where practical, fixture-based regression tests should assert that refactored use cases emit the same JSON shapes and decision outputs as the current scripts for representative complete, partial, stale, and cron dry-run cases.

Keep `pnpm typecheck` green, add a boundary-check script, and make a combined verification script run typecheck, tests, and import-boundary checks.

## Scope And Migration

This issue is an in-place refactor only. It introduces the layered `src/` structure, moves current behavior behind that structure, and documents/enforces boundaries. It does not introduce evidence-bundle contracts, DB persistence, new collectors, Regime Engine publishing, or dual legacy/new outputs.

Migration will be full for today's code surface: current collectors, generators, cron render/sync helpers, shared fs/http/env helpers, and pure metrics logic all move behind `src/`. Top-level non-code product assets stay in place: `policies/`, `prompts/`, `routines/`, `resources/`, `schemas/`, `memory/`, and `cron/`. Existing runtime artifact paths such as `data/` and `outputs/` also remain stable.

The stable external surface is:

```text
pnpm collect:price
pnpm collect:backend
pnpm insight:daily
pnpm review:range
pnpm review:weekly
pnpm cron:render
pnpm cron:sync
pnpm cron:sync -- --apply
```

The refactor may add test, boundary, and combined verification commands, but must not break the existing commands or change their output paths.

`README.md` and `docs/architecture.md` will be updated to explain the layered monolith, no-execution boundary, current legacy-output preservation, and the downstream split: evidence-bundle publication belongs to INT-PUBLISH (#13), while legacy recommendation-flow removal belongs to INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (#14) after the replacement path is live.

## Non-Goals

- No evidence-bundle contract or publication path in this issue.
- No DB persistence, schema migrations, or repository storage layer.
- No new source collectors.
- No Regime Engine integration.
- No wallet, signing, transaction, rebalance, swap, or withdrawal behavior.
- No removal of current recommendation outputs or cron jobs.
- No movement of top-level product assets into `src/`.

## Acceptance Mapping

- New layered `src/` structure exists with documented responsibilities: covered by `src/domain`, `src/application`, `src/ports`, `src/adapters`, `src/jobs`, and `src/contracts`.
- Existing CLI/script commands still work but delegate to application use cases: covered by thin `scripts/*` entrypoints and stable command surface.
- Pure business logic is no longer trapped inside procedural script entrypoints: covered by `src/domain` advisory logic and domain tests.
- Source adapters do not directly own workflow orchestration: covered by ports/adapters split and dependency-cruiser rules.
- Non-code prompt/policy/routine assets remain first-class repo assets: covered by scope and migration rules.
- README documents the new architecture and no-execution boundary: covered by documentation update requirement.
- Typecheck and existing behavior remain green: covered by verification requirements.
