import type {
  DerivativesClaim,
  Identifier128
} from "../../contracts/generated/evidence-bundle-v1.js";
import type { SelectedFeatureSlot, SelectedAvailableSlot, SelectedPartialSlot } from "./select.js";
import { toCanonicalTimestamp } from "./timestamp.js";

const DERIVATIVE_KINDS = {
  funding_rate_annualized: "funding",
  oi_trend_4h: "open_interest",
  liquidation_cluster_1h: "liquidation"
} as const;

type DerivativeFeatureKind = keyof typeof DERIVATIVE_KINDS;

function isDerivativeFeatureKind(kind: string): kind is DerivativeFeatureKind {
  return kind in DERIVATIVE_KINDS;
}

function getRawObservationIds(slot: SelectedFeatureSlot): number[] {
  if (slot.outcome !== "selected_available" && slot.outcome !== "selected_partial") {
    return [];
  }
  if (!slot.provenance || !slot.provenance.rawObservationRefs) {
    return [];
  }
  const rawRefs = slot.provenance.rawObservationRefs.filter(
    (ref) => ref.refType === "raw_observation"
  );
  const ids = rawRefs.map((ref) => ref.id);
  const uniqueIds = Array.from(new Set(ids)).sort((a, b) => a - b);
  return uniqueIds;
}

function isEligibleDerivativeSlot(
  slot: SelectedFeatureSlot
): slot is (SelectedAvailableSlot | SelectedPartialSlot) & { featureKind: DerivativeFeatureKind } {
  if (slot.outcome !== "selected_available" && slot.outcome !== "selected_partial") {
    return false;
  }
  if (!isDerivativeFeatureKind(slot.featureKind)) {
    return false;
  }
  const rawIds = getRawObservationIds(slot);
  return rawIds.length > 0;
}

function formatSignedBps(value: number): string {
  return value > 0 ? `+${value} BPS` : `${value} BPS`;
}

function getFeatureTimeWindow(featureKind: DerivativeFeatureKind): string {
  switch (featureKind) {
    case "funding_rate_annualized":
      return "annualized";
    case "oi_trend_4h":
      return "4h";
    case "liquidation_cluster_1h":
      return "1h";
  }
}

export function hasUsableDerivativeSlots(slots: readonly SelectedFeatureSlot[]): boolean {
  return slots.some(isEligibleDerivativeSlot);
}

export function buildDerivativeClaims(slots: readonly SelectedFeatureSlot[]): DerivativesClaim[] {
  const eligibleSlots = slots.filter(isEligibleDerivativeSlot);

  return eligibleSlots.map((slot) => {
    const kind = DERIVATIVE_KINDS[slot.featureKind];
    const rawIds = getRawObservationIds(slot);
    const sourceReferenceIds = rawIds.map((id) => `raw-${id}` as Identifier128).slice(0, 64) as [
      Identifier128,
      ...Identifier128[]
    ];

    let direction: "bullish" | "bearish" | "neutral" | "mixed";
    if (kind === "liquidation") {
      direction = slot.value > 0 ? "mixed" : "neutral";
    } else {
      if (slot.value > 0) {
        direction = "bullish";
      } else if (slot.value < 0) {
        direction = "bearish";
      } else {
        direction = "neutral";
      }
    }

    const signedBps = formatSignedBps(slot.value);
    const window = getFeatureTimeWindow(slot.featureKind);
    const rawClaimText = `${slot.featureKind}: ${signedBps} (${window})`;
    const claim = rawClaimText.length > 512 ? rawClaimText.slice(0, 512) : rawClaimText;

    const confidenceBps = Math.max(0, Math.min(10_000, Math.round(slot.confidence.compositeScore)));

    const observedAt = toCanonicalTimestamp(slot.asOfUnixMs);
    const expiresAt =
      slot.validUntilUnixMs !== null ? toCanonicalTimestamp(slot.validUntilUnixMs) : null;

    return {
      evidenceId: `derivative-${slot.featureKind}-${slot.rowId}` as Identifier128,
      kind,
      claim,
      direction,
      confidenceBps,
      observedAt,
      expiresAt,
      sourceReferenceIds,
      provenanceMethod: "derived"
    };
  });
}
