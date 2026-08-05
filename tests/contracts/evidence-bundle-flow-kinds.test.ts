import { describe, it, expect, beforeAll } from "vitest";
import { createEvidenceBundleContract } from "../../src/adapters/node/evidence-bundle-v1-contract.js";
import { loadValidFixture } from "../fixtures/evidence-bundle.js";
import type { FlowClaim } from "../../src/contracts/generated/evidence-bundle-v1.js";
import type { EvidenceBundleContractError } from "../../src/contracts/evidence-bundle.js";

const canonicalKinds = ["spot_flow", "stablecoin_flow", "exchange_flow"] as const;
const collectorOnlyKinds = [
  "dex_net_flow",
  "whale_swap",
  "whale_transfer",
  "cex_flow_proxy"
] as const;

describe("EvidenceBundleV1 flow claim kinds contract", () => {
  let contract: ReturnType<typeof createEvidenceBundleContract>;
  let baseFixture: object;

  beforeAll(async () => {
    contract = createEvidenceBundleContract();
    baseFixture = await loadValidFixture("contextual");
  });

  describe("accepts every regime-engine flow kind", () => {
    it.each(canonicalKinds)("accepts %s kind", async (kind) => {
      const fixture = JSON.parse(JSON.stringify(baseFixture)) as Record<string, unknown>;
      const flows = (fixture.contextualEvidence as Record<string, unknown>).flows as Array<
        Record<string, unknown>
      >;
      flows[0]!.kind = kind;

      const result = await contract.validateCanonicalizeAndHash(fixture);
      expect(result.schemaVersion).toBe("evidence-bundle.v1");
      expect(result.payload).toBeDefined();
    });
  });

  describe("rejects every collector-only flow kind", () => {
    it.each(collectorOnlyKinds)("rejects %s kind", async (kind) => {
      const fixture = JSON.parse(JSON.stringify(baseFixture)) as Record<string, unknown>;
      const flows = (fixture.contextualEvidence as Record<string, unknown>).flows as Array<
        Record<string, unknown>
      >;
      flows[0]!.kind = kind;

      try {
        await contract.validateCanonicalizeAndHash(fixture);
        expect.unreachable("Should have thrown validation error for collector-only flow kind");
      } catch (err) {
        const error = err as EvidenceBundleContractError;
        expect(error.code).toBe("VALIDATION_ERROR");
        if (error.code === "VALIDATION_ERROR") {
          const hasKindError = (error.errors as Array<{ instancePath?: string }>).some(
            (e) => e.instancePath === "/contextualEvidence/flows/0/kind"
          );
          expect(hasKindError).toBe(true);
        }
      }
    });
  });

  describe("generated FlowClaim exposes only canonical flow kinds", () => {
    it("compiles for accepted canonical kinds and rejects collector-only kinds", () => {
      const acceptedKinds: FlowClaim["kind"][] = ["spot_flow", "stablecoin_flow", "exchange_flow"];
      void acceptedKinds;

      // @ts-expect-error collector-only kinds must not be publishable contract values
      const rejectedDexNetFlow: FlowClaim["kind"] = "dex_net_flow";
      void rejectedDexNetFlow;

      // @ts-expect-error collector-only kinds must not be publishable contract values
      const rejectedWhaleSwap: FlowClaim["kind"] = "whale_swap";
      void rejectedWhaleSwap;

      // @ts-expect-error collector-only kinds must not be publishable contract values
      const rejectedWhaleTransfer: FlowClaim["kind"] = "whale_transfer";
      void rejectedWhaleTransfer;

      // @ts-expect-error collector-only kinds must not be publishable contract values
      const rejectedCexFlowProxy: FlowClaim["kind"] = "cex_flow_proxy";
      void rejectedCexFlowProxy;
    });
  });
});
