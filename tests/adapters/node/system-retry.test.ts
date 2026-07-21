import { describe, expect, it, vi, afterEach } from "vitest";
import { SystemRetryControl } from "../../../src/adapters/node/system-retry.js";

describe("SystemRetryControl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("sleep", () => {
    it("resolves after approximately the specified milliseconds", async () => {
      vi.useFakeTimers();
      const control = new SystemRetryControl();
      const start = Date.now();

      const sleepPromise = control.sleep(100);
      vi.advanceTimersByTime(100);
      await sleepPromise;

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95);
      expect(elapsed).toBeLessThan(200);
    });

    it("resolves when timer is advanced past the sleep duration", async () => {
      vi.useFakeTimers();
      const control = new SystemRetryControl();
      let resolved = false;

      void control.sleep(50).then(() => {
        resolved = true;
      });

      vi.advanceTimersByTime(30);
      expect(resolved).toBe(false);

      vi.advanceTimersByTime(25);
      expect(resolved).toBe(false);

      vi.advanceTimersByTime(5);
      await Promise.resolve();
      expect(resolved).toBe(true);
    });

    it("returns a Promise that can be awaited", async () => {
      vi.useFakeTimers();
      const control = new SystemRetryControl();

      const promise = control.sleep(10);
      vi.advanceTimersByTime(10);
      const result = await promise;
      expect(result).toBeUndefined();
    });
  });

  describe("jitterUnit", () => {
    it("returns a number between 0 (inclusive) and 1 (exclusive)", () => {
      const control = new SystemRetryControl();

      for (let i = 0; i < 100; i++) {
        const jitter = control.jitterUnit();
        expect(jitter).toBeGreaterThanOrEqual(0);
        expect(jitter).toBeLessThan(1);
      }
    });

    it("returns values that vary between calls", () => {
      const control = new SystemRetryControl();
      const values = new Set<number>();

      for (let i = 0; i < 10; i++) {
        values.add(control.jitterUnit());
      }

      expect(values.size).toBeGreaterThan(1);
    });

    it("returns deterministic values within a single test when Math.random is controlled", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const control = new SystemRetryControl();

      expect(control.jitterUnit()).toBe(0.5);
      expect(control.jitterUnit()).toBe(0.5);
    });
  });
});
