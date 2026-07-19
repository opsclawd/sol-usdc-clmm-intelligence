# Fix Secret Redacting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `secretRedactingReplacer` in `scripts/collectors/jupiter-price.ts` so that it redacts values whose keys match secret names, as well as preserving inline redactions in values, and add test coverage.

**Architecture:** Update `secretRedactingReplacer` to check both if the key matches a secret pattern (e.g. `api_key`, `bearer`, `token`, `auth`, `secret`) and if a string value contains sensitive patterns. Add unit tests verifying both types of redaction.

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- Never log secrets.
- Keep JSON output safe.

---

### Task 1: Fix secretRedactingReplacer and add tests

**Files:**

- Modify: `scripts/collectors/jupiter-price.ts`
- Modify: `tests/scripts/price-observations.test.ts`

**Interfaces:**

- Consumes: `runPriceObservationsJob` from `src/jobs/price-observations-job.ts`
- Produces: `runCollector` from `scripts/collectors/jupiter-price.ts`

- [ ] **Step 1: Write a test verifying that secrets in keys are redacted**

  Add the following test case inside `tests/scripts/price-observations.test.ts`:

  ```typescript
  it("redacts sensitive fields by key and sensitive patterns in strings", async () => {
    const mockResult = {
      pyth: { status: "accepted", rawObservationId: 101, normalizedCount: 1, warnings: [] },
      jupiter: { status: "accepted", rawObservationId: 102, normalizedCount: 1, warnings: [] },
      warnings: ["failed with api_key=123"],
      apiKey: "super-secret-key-123",
      bearerToken: "some-bearer-token",
      shouldFailCommand: false
    };
    (runPriceObservationsJob as Mock).mockResolvedValue(mockResult);

    await runCollector();

    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls;
    expect(calls[0]).toBeDefined();
    const printed = JSON.parse(calls[0]![0] as string);
    expect(printed.apiKey).toBe("[REDACTED]");
    expect(printed.bearerToken).toBe("[REDACTED]");
    expect(printed.warnings[0]).toBe("failed with [REDACTED]=123");
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `pnpm vitest run tests/scripts/price-observations.test.ts`
  Expected: FAIL (because `apiKey` is not redacted, it'll output `"super-secret-key-123"`)

- [ ] **Step 3: Modify `secretRedactingReplacer` in `scripts/collectors/jupiter-price.ts`**

  Replace `secretRedactingReplacer` with:

  ```typescript
  function secretRedactingReplacer(key: string, value: unknown): unknown {
    if (/(api[_-]?key|bearer|token|auth|secret)/i.test(key)) {
      return "[REDACTED]";
    }
    if (typeof value === "string") {
      return redactSecrets(value);
    }
    return value;
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `pnpm vitest run tests/scripts/price-observations.test.ts`
  Expected: PASS

- [ ] **Step 5: Run full verification suite**

  Run: `pnpm verify`
  Expected: PASS

- [ ] **Step 6: Commit**

  Record HEAD before, commit and run contract checks.
