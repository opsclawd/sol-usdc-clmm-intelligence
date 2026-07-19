# Fix Step 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dynamic composition root import fallback from both `src/application/collect-price-observations.ts` and `src/jobs/price-observations-job.ts`, enforcing strict dependency injection from entrypoints.

**Architecture:** Change parameters `rawObservationRepo` and `normalizedObservationRepo` to be required in `CollectPriceObservationsDeps`. Remove the fallback dynamic import block entirely.

**Tech Stack:** TypeScript, Node.js

## Global Constraints

- Do not import any node adapters inside the `src/application` or `src/jobs` directories.
- Ensure all tests pass.

---

### Task 1: Modify collect-price-observations.ts and price-observations-job.ts

**Files:**

- Modify: `src/application/collect-price-observations.ts`
- Modify: `src/jobs/price-observations-job.ts`

**Interfaces:**

- Consumes: `RawObservationRepo` and `NormalizedObservationRepo` from ports
- Produces: Updated `CollectPriceObservationsDeps` with non-optional repo properties and no import fallback

- [ ] **Step 1: Remove dynamic import fallback and update interface in `src/application/collect-price-observations.ts`**
- [ ] **Step 2: Remove dynamic import fallback in `src/jobs/price-observations-job.ts`**
- [ ] **Step 3: Run typescript verification**
      Run: `pnpm typecheck`
      Expected: PASS
- [ ] **Step 4: Run formatting and linting**
      Run: `pnpm format && pnpm lint`
      Expected: PASS
- [ ] **Step 5: Run tests and boundaries**
      Run: `pnpm test && pnpm boundaries`
      Expected: PASS
