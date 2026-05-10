import { describe, expect, it } from "vitest";
import {
  derivePosture,
  deriveRangeBias,
  deriveRebalanceSensitivity,
  deriveMaxCapitalDeploymentPercent
} from "../../src/domain/advisory-policy.js";

describe("deriveRangeBias", () => {
  it("returns passive when action is pause_rebalances", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "pause_rebalances",
        riskLevel: "elevated",
        feeEnvironment: "strong",
        breachRisk: "low"
      })
    ).toBe("passive");
  });

  it("returns wide when action is widen_range", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "widen_range",
        riskLevel: "normal",
        feeEnvironment: "normal",
        breachRisk: "high"
      })
    ).toBe("wide");
  });

  it("returns wide when riskLevel is elevated even if action is hold", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "hold",
        riskLevel: "elevated",
        feeEnvironment: "strong",
        breachRisk: "low"
      })
    ).toBe("wide");
  });

  it("returns medium on strong fees and low breach risk when action is hold", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "hold",
        riskLevel: "normal",
        feeEnvironment: "strong",
        breachRisk: "low"
      })
    ).toBe("medium");
  });

  it("returns wide on weak fees", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "hold",
        riskLevel: "normal",
        feeEnvironment: "weak",
        breachRisk: "low"
      })
    ).toBe("wide");
  });

  it("returns medium otherwise", () => {
    expect(
      deriveRangeBias({
        recommendedAction: "watch",
        riskLevel: "normal",
        feeEnvironment: "normal",
        breachRisk: "medium"
      })
    ).toBe("medium");
  });
});

describe("derivePosture", () => {
  it("returns paused on pause_rebalances", () => {
    expect(
      derivePosture({
        recommendedAction: "pause_rebalances",
        riskLevel: "normal",
        feeEnvironment: "strong"
      })
    ).toBe("paused");
  });

  it("returns defensive on critical risk", () => {
    expect(
      derivePosture({
        recommendedAction: "exit_range",
        riskLevel: "critical",
        feeEnvironment: "strong"
      })
    ).toBe("defensive");
  });

  it("returns defensive on elevated risk", () => {
    expect(
      derivePosture({
        recommendedAction: "watch",
        riskLevel: "elevated",
        feeEnvironment: "normal"
      })
    ).toBe("defensive");
  });

  it("returns moderately_aggressive on strong fees and normal risk", () => {
    expect(
      derivePosture({
        recommendedAction: "hold",
        riskLevel: "normal",
        feeEnvironment: "strong"
      })
    ).toBe("moderately_aggressive");
  });

  it("returns defensive on weak fees and normal risk", () => {
    expect(
      derivePosture({
        recommendedAction: "hold",
        riskLevel: "normal",
        feeEnvironment: "weak"
      })
    ).toBe("defensive");
  });

  it("returns neutral otherwise", () => {
    expect(
      derivePosture({
        recommendedAction: "hold",
        riskLevel: "normal",
        feeEnvironment: "normal"
      })
    ).toBe("neutral");
  });
});

describe("deriveRebalanceSensitivity", () => {
  it("returns paused on pause_rebalances", () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: "pause_rebalances",
        riskLevel: "normal"
      })
    ).toBe("paused");
  });

  it("returns high on elevated risk", () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: "watch",
        riskLevel: "elevated"
      })
    ).toBe("high");
  });

  it("returns normal otherwise", () => {
    expect(
      deriveRebalanceSensitivity({
        recommendedAction: "hold",
        riskLevel: "normal"
      })
    ).toBe("normal");
  });
});

describe("deriveMaxCapitalDeploymentPercent", () => {
  it("returns 50 when posture is defensive", () => {
    expect(deriveMaxCapitalDeploymentPercent("defensive")).toBe(50);
  });

  it("returns 50 when posture is paused", () => {
    expect(deriveMaxCapitalDeploymentPercent("paused")).toBe(50);
  });

  it("returns 70 when posture is neutral", () => {
    expect(deriveMaxCapitalDeploymentPercent("neutral")).toBe(70);
  });

  it("returns 70 when posture is moderately_aggressive", () => {
    expect(deriveMaxCapitalDeploymentPercent("moderately_aggressive")).toBe(70);
  });
});
