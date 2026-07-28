# Task Context: Task 1

Title: Emit required context and research-brief warnings

## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/sol-usdc-clmm-intelligence/.ai-worktrees/issue-64
Repository: opsclawd/sol-usdc-clmm-intelligence
Branch: ai/issue-64
Start Commit: d29094d0cd501b0b730f2530c25d4acf38fd8c60

## Task Requirements

**Files:**

- Modify: `tests/domain/evidence-bundle/quality.test.ts` — only the `classifies all seven fresh available slots...` and `maps deterministic-only context and brief absence exactly` describe-blocks.
- Modify: `src/domain/evidence-bundle/quality.ts` — only `buildWarnings(...)`.

**Reference files:**

- Read only: `schemas/regime-engine/evidence-bundle.v1/fixtures/valid/deterministic-only.json` for the canonical codes, messages, and affected-family names.
- Read only: `src/adapters/node/evidence-bundle-v1-contract.ts` for the empty-context and null-brief cross-field checks.

**Behavioral invariants and named tests:**

1. **Both absence warnings:** Given `contextPresent: false` and `briefPresent: false`, append both required warnings with their exact canonical payloads.
   Test first: `emits required contract warnings when context and brief are absent`.
2. **No false absence warnings:** Given `contextPresent: true` and `briefPresent: true`, emit neither required warning.
   Test first: `omits required absence warnings when context and brief are present`.
3. **Independent brief warning:** Given `contextPresent: true` and `briefPresent: false`, emit `RESEARCH_BRIEF_UNAVAILABLE` but not `CONTEXTUAL_EVIDENCE_UNAVAILABLE`.
   Test first: `emits only the research brief warning when context exists without a brief`.
4. **Stable required-warning composition:** The two new warnings appear at most once and in contextual-then-brief order because `buildWarnings` executes each absence branch once.
   Covered by the exact warning-code array assertion in the first test.

- [ ] **Step 1: Write the failing warning truth-table tests**

Update the obsolete assertion in the complete-deterministic-coverage case so it no longer expects an empty warning list when both optional evidence classes are absent. In the existing `maps deterministic-only context and brief absence exactly` describe-block, add focused tests using this shape:

```ts
it("emits required contract warnings when context and brief are absent", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: false,
      briefPresent: false
    })
  );

  expect(result.warnings.map((warning) => warning.code)).toEqual([
    "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    "RESEARCH_BRIEF_UNAVAILABLE"
  ]);
  expect(result.warnings).toContainEqual({
    code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    message: "All contextual evidence families are unavailable",
    affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
  });
  expect(result.warnings).toContainEqual({
    code: "RESEARCH_BRIEF_UNAVAILABLE",
    message: "Research brief is null",
    affectedFamilies: ["researchBrief"]
  });
});

it("omits required absence warnings when context and brief are present", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: true,
      briefPresent: true
    })
  );

  expect(
    result.warnings.filter(
      (warning) =>
        warning.code === "CONTEXTUAL_EVIDENCE_UNAVAILABLE" ||
        warning.code === "RESEARCH_BRIEF_UNAVAILABLE"
    )
  ).toEqual([]);
});

it("emits only the research brief warning when context exists without a brief", () => {
  const result = classifyEvidenceBundleQuality(
    makeQualityInput(makeSlotsAllAvailable(), {
      contextPresent: true,
      briefPresent: false
    })
  );

  expect(result.warnings.map((warning) => warning.code)).toEqual(["RESEARCH_BRIEF_UNAVAILABLE"]);
});
```

- [ ] **Step 2: Run only the new warning cases and confirm the pre-fix failure**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts -t "emits required contract warnings|omits required absence warnings|emits only the research brief warning"
```

Expected before implementation: the absence cases fail because `buildWarnings` does not use `contextPresent` or `briefPresent`; the present/present case may already pass.

- [ ] **Step 3: Implement the minimal quality warning branches**

Append the required warnings in `buildWarnings(...)` after the existing slot-status warning branches and before returning:

```ts
if (!contextPresent) {
  warnings.push({
    code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
    message: "All contextual evidence families are unavailable",
    affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
  });
}

if (!briefPresent) {
  warnings.push({
    code: "RESEARCH_BRIEF_UNAVAILABLE",
    message: "Research brief is null",
    affectedFamilies: ["researchBrief"]
  });
}
```

Do not change `computeQualityLevel`, `computeOverallConfidence`, or the `coverage` object. The new warnings communicate absence without redefining those existing outputs.

- [ ] **Step 4: Run task-scoped tests and static checks**

Run:

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts
pnpm exec eslint src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
pnpm exec prettier --check src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
```

Expected: the quality test file passes; ESLint and Prettier report no errors. The implementation loop's automatic `pnpm -r typecheck` gate must also pass.

- [ ] **Step 5: Commit the warning behavior**

```bash
git add src/domain/evidence-bundle/quality.ts tests/domain/evidence-bundle/quality.test.ts
git commit -m "fix: emit required evidence absence warnings"
```

Acceptance criteria:

- Both false flags produce both exact canonical warning payloads.
- Each true flag suppresses only its corresponding absence warning.
- Existing slot warning tests remain green.
- No exported API signature changes.

## Repository Targets

### Expected Files

- src/domain/evidence-bundle/quality.ts
- tests/domain/evidence-bundle/quality.test.ts

### Reference Files

- schemas/regime-engine/evidence-bundle.v1/fixtures/valid/deterministic-only.json
- src/adapters/node/evidence-bundle-v1-contract.ts

## Validation Commands

```bash
pnpm exec vitest run tests/domain/evidence-bundle/quality.test.ts
["pnpm","exec","eslint","src/domain/evidence-bundle/quality.ts","tests/domain/evidence-bundle/quality.test.ts"]
["pnpm","exec","prettier","--check","src/domain/evidence-bundle/quality.ts","tests/domain/evidence-bundle/quality.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **both absence warnings**: When contextPresent and briefPresent are both false, append exactly one canonical CONTEXTUAL_EVIDENCE_UNAVAILABLE warning and one canonical RESEARCH_BRIEF_UNAVAILABLE warning. (Test: `emits required contract warnings when context and brief are absent`)
- **no false absence warnings**: When contextPresent and briefPresent are both true, emit neither contract absence-warning code. (Test: `omits required absence warnings when context and brief are present`)
- **independent brief warning**: When contextPresent is true and briefPresent is false, emit RESEARCH_BRIEF_UNAVAILABLE without CONTEXTUAL_EVIDENCE_UNAVAILABLE. (Test: `emits only the research brief warning when context exists without a brief`)
- **stable warning composition**: Each required absence warning is appended at most once, with contextual absence preceding brief absence. (Test: `emits required contract warnings when context and brief are absent`)
