import { describe, expect, it } from "vitest";
import { classifyFeeEnvironment } from "../../src/domain/fee-classification.js";
import type { PoolSnapshot } from "../../src/contracts/snapshots.js";

const base: PoolSnapshot = {
  pair: "SOL/USDC",
  timestamp: "2026-05-10T12:00:00.000Z",
  source: "test"
};

describe("classifyFeeEnvironment", () => {
  it("returns unknown when pool is undefined", () => {
    expect(classifyFeeEnvironment(undefined)).toBe("unknown");
  });

  it("returns unknown when feeApr is missing", () => {
    expect(classifyFeeEnvironment({ ...base })).toBe("unknown");
  });

  it("returns strong when feeApr is 80", () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 80 })).toBe("strong");
  });

  it("returns strong when feeApr is well above 80", () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 250 })).toBe("strong");
  });

  it("returns normal when feeApr is 25", () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 25 })).toBe("normal");
  });

  it("returns normal when feeApr is in [25, 80)", () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 60 })).toBe("normal");
  });

  it("returns weak when feeApr is below 25", () => {
    expect(classifyFeeEnvironment({ ...base, feeApr: 10 })).toBe("weak");
  });
});
