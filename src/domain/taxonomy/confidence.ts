import type {
  ConfidenceComponents,
  ConfidenceWeights,
  ConfidencePolicy,
  ConfidenceThresholds,
  ConfidenceReason,
  Confidence,
  ConfidenceLevel
} from "../../contracts/taxonomy.js";

export class ConfidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfidenceValidationError";
  }
}

function validateComponentRange(value: number, name: string): void {
  if (value < 0 || value > 1) {
    throw new ConfidenceValidationError(`${name} (${value}) must be in [0, 1]`);
  }
}

function validateWeightRange(value: number, name: string): void {
  if (value < 0 || value > 1) {
    throw new ConfidenceValidationError(`${name} weight (${value}) must be in [0, 1]`);
  }
}

export function computeConfidence(
  components: ConfidenceComponents,
  policy: ConfidencePolicy,
  weightingVersion: string,
  staleDegradation?: { readonly factor: number },
  additionalReasons: readonly ConfidenceReason[] = []
): Confidence {
  const { weights, thresholds, redistributeLlmWeight } = policy;
  const reasons: ConfidenceReason[] = [];

  validateComponentRange(components.sourceReliability, "sourceReliability");
  validateComponentRange(components.dataCompleteness, "dataCompleteness");
  validateComponentRange(components.derivationConfidence, "derivationConfidence");
  validateWeightRange(weights.sourceReliability, "sourceReliability");
  validateWeightRange(weights.dataCompleteness, "dataCompleteness");
  validateWeightRange(weights.derivationConfidence, "derivationConfidence");
  validateWeightRange(weights.llmConfidence, "llmConfidence");

  if (components.llmConfidence !== null) {
    validateComponentRange(components.llmConfidence, "llmConfidence");
  }

  let effectiveWeights: ConfidenceWeights;

  if (components.llmConfidence === null) {
    if (!redistributeLlmWeight && weights.llmConfidence > 0) {
      throw new ConfidenceValidationError(
        "llmConfidence is null but redistributeLlmWeight is false and llmConfidence weight > 0"
      );
    }

    if (!redistributeLlmWeight && weights.llmConfidence === 0) {
      reasons.push("required_component_missing");
    }

    if (redistributeLlmWeight && weights.llmConfidence > 0) {
      const remainingTotal =
        weights.sourceReliability + weights.dataCompleteness + weights.derivationConfidence;
      if (remainingTotal === 0) {
        throw new ConfidenceValidationError(
          "cannot redistribute llmConfidence weight: all other weights are zero"
        );
      }
      const scale = 1 / (1 - weights.llmConfidence);
      effectiveWeights = {
        sourceReliability: weights.sourceReliability * scale,
        dataCompleteness: weights.dataCompleteness * scale,
        derivationConfidence: weights.derivationConfidence * scale,
        llmConfidence: 0
      };
      reasons.push("llm_weight_redistributed");
    } else {
      effectiveWeights = { ...weights };
    }
  } else {
    effectiveWeights = { ...weights };
  }

  const rawSum =
    effectiveWeights.sourceReliability +
    effectiveWeights.dataCompleteness +
    effectiveWeights.derivationConfidence +
    effectiveWeights.llmConfidence;

  if (Math.abs(rawSum - 1.0) > 1e-9) {
    throw new ConfidenceValidationError(`effective weights sum to ${rawSum}, expected 1.0`);
  }

  let compositeScore: number;

  if (components.llmConfidence === null || effectiveWeights.llmConfidence === 0) {
    compositeScore =
      effectiveWeights.sourceReliability * components.sourceReliability +
      effectiveWeights.dataCompleteness * components.dataCompleteness +
      effectiveWeights.derivationConfidence * components.derivationConfidence;

    const nonZeroDenom =
      effectiveWeights.sourceReliability +
      effectiveWeights.dataCompleteness +
      effectiveWeights.derivationConfidence;
    if (nonZeroDenom > 0) {
      compositeScore = compositeScore / nonZeroDenom;
    }
  } else {
    compositeScore =
      effectiveWeights.sourceReliability * components.sourceReliability +
      effectiveWeights.dataCompleteness * components.dataCompleteness +
      effectiveWeights.derivationConfidence * components.derivationConfidence +
      effectiveWeights.llmConfidence * components.llmConfidence;
  }

  if (components.sourceReliability < 0.3) {
    reasons.push("source_reliability_low");
  }
  if (components.dataCompleteness < 0.3) {
    reasons.push("data_completeness_low");
  }
  if (components.derivationConfidence < 0.3) {
    reasons.push("derivation_confidence_low");
  }

  if (staleDegradation !== undefined) {
    if (staleDegradation.factor < 0 || staleDegradation.factor > 1) {
      throw new ConfidenceValidationError(
        `stale degradation factor (${staleDegradation.factor}) must be in [0, 1]`
      );
    }
    compositeScore = compositeScore * staleDegradation.factor;
    reasons.push("stale_input_degraded");
  }

  compositeScore = Math.max(0, Math.min(1, compositeScore));

  const level: ConfidenceLevel = deriveLevel(compositeScore, thresholds);

  const allReasons = [...reasons, ...additionalReasons.filter((r) => !reasons.includes(r))];

  return {
    components,
    compositeScore,
    level,
    weightingVersion,
    reasons: allReasons
  };
}

function deriveLevel(composite: number, thresholds: ConfidenceThresholds): ConfidenceLevel {
  if (composite >= thresholds.highAtOrAbove) return "high";
  if (composite < thresholds.lowBelow) return "low";
  return "medium";
}
