import { describe, it, expect } from "vitest";
import type {
  OnChainFlowPayloadV1,
  WhaleSwapPayloadV1,
  StablecoinFlowPayloadV1,
  DexNetFlowPayloadV1,
  CexFlowProxyPayloadV1,
  OnChainFlowDirection,
  OnChainAddressContext,
  OnChainFlowSourceQuality,
  OnChainFlowThresholds
} from "../../src/contracts/on-chain-flow.js";

const BASE_COMMON_FIELDS = {
  schemaVersion: 1 as const,
  eventFamily: "on_chain_flow" as const,
  eventType: "whale_swap" as const,
  sourceEventId: "tx_abc123_sig_0" as const,
  observedAtUnixMs: Date.now(),
  amountUsdc: "500000" as const,
  direction: "inbound" as OnChainFlowDirection,
  venue: "solana" as const,
  addressContext: {
    addressType: "wallet",
    address: "Wallet123"
  } as OnChainAddressContext,
  sourceReferences: ["helius:tx_abc123"] as readonly string[],
  sourceQuality: {
    provider: "helius-api",
    freshness: "realtime",
    completeness: "full"
  } as OnChainFlowSourceQuality,
  freshnessContext: {
    slot: 123456789,
    blockTimestampUnixMs: Date.now()
  }
};

describe("OnChainFlowPayloadV1 union", () => {
  it("contains WhaleSwapPayloadV1 with swap-specific fields", () => {
    const swap: WhaleSwapPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "whale_swap",
      transactionSignature: "swap_sig_xyz",
      eventIndex: 1,
      slot: 123456790,
      stablecoinOperation: "transfer"
    };
    expect(swap.eventType).toBe("whale_swap");
    expect(swap.transactionSignature).toBe("swap_sig_xyz");
  });

  it("contains StablecoinFlowPayloadV1 with mint/burn/transfer operations", () => {
    const mint: StablecoinFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "stablecoin_flow",
      transactionSignature: "mint_sig",
      eventIndex: 2,
      slot: 123456791,
      stablecoinOperation: "mint"
    };
    expect(mint.stablecoinOperation).toBe("mint");

    const burn: StablecoinFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "stablecoin_flow",
      transactionSignature: "burn_sig",
      eventIndex: 3,
      slot: 123456792,
      stablecoinOperation: "burn"
    };
    expect(burn.stablecoinOperation).toBe("burn");

    const transferOp: StablecoinFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "stablecoin_flow",
      transactionSignature: "transfer_op_sig",
      eventIndex: 4,
      slot: 123456793,
      stablecoinOperation: "transfer"
    };
    expect(transferOp.stablecoinOperation).toBe("transfer");
  });

  it("contains DexNetFlowPayloadV1 with DEX window fields", () => {
    const dex: DexNetFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "dex_net_flow",
      windowStartUnixMs: Date.now() - 900_000,
      windowEndUnixMs: Date.now(),
      buyVolumeUsdc: "250000",
      sellVolumeUsdc: "100000",
      netFlowUsdc: "150000"
    };
    expect(dex.windowStartUnixMs).toBeLessThan(dex.windowEndUnixMs);
    expect(dex.buyVolumeUsdc).toBe("250000");
    expect(dex.sellVolumeUsdc).toBe("100000");
    expect(dex.netFlowUsdc).toBe("150000");
  });

  it("contains CexFlowProxyPayloadV1 with quality=proxy and attribution metadata", () => {
    const cex: CexFlowProxyPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy",
      venue: "cex",
      quality: "proxy" as const,
      attributionConfidence: 0.75,
      attributionProvider: "helius-api",
      caveats: ["estimated_from_related_addresses"]
    };
    expect(cex.quality).toBe("proxy");
    expect(cex.attributionConfidence).toBe(0.75);
    expect(cex.attributionProvider).toBe("helius-api");
    expect(cex.caveats).toContain("estimated_from_related_addresses");
  });
});

describe("OnChainFlowDirection", () => {
  it("accepts inbound and outbound directions", () => {
    const inbound: OnChainFlowDirection = "inbound";
    const outbound: OnChainFlowDirection = "outbound";
    expect(inbound).toBe("inbound");
    expect(outbound).toBe("outbound");
  });
});

describe("OnChainAddressContext", () => {
  it("accepts wallet address type", () => {
    const ctx: OnChainAddressContext = {
      addressType: "wallet",
      address: "WalletXYZ"
    };
    expect(ctx.addressType).toBe("wallet");
  });

  it("accepts contract address type", () => {
    const ctx: OnChainAddressContext = {
      addressType: "contract",
      address: "ContractABC"
    };
    expect(ctx.addressType).toBe("contract");
  });
});

describe("OnChainFlowThresholds", () => {
  it("defines minimum thresholds for each flow kind", () => {
    const thresholds: OnChainFlowThresholds = {
      whaleSwapMinUsdc: "100000",
      stablecoinFlowMinUsdc: "1000",
      dexNetFlowMinUsdc: "50000",
      cexFlowProxyMinUsdc: "50000",
      cexMinAttributionConfidence: 0.5
    };
    expect(thresholds.whaleSwapMinUsdc).toBe("100000");
    expect(thresholds.cexMinAttributionConfidence).toBe(0.5);
  });
});

describe("registering deterministic on-chain transaction facts and probabilistic CEX proxies", () => {
  it("whale_swap, stablecoin_flow, and dex_net_flow use deterministic signal class", () => {
    const deterministicKinds = ["whale_swap", "stablecoin_flow", "dex_net_flow"] as const;
    for (const kind of deterministicKinds) {
      const payload = { ...BASE_COMMON_FIELDS, eventType: kind };
      expect(payload.eventFamily).toBe("on_chain_flow");
    }
  });

  it("cex_flow_proxy uses probabilistic signal class via quality=proxy", () => {
    const cexPayload = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy" as const,
      quality: "proxy" as const,
      attributionConfidence: 0.75,
      attributionProvider: "helius-api",
      caveats: [] as readonly string[]
    };
    expect(cexPayload.quality).toBe("proxy");
  });
});

describe("allowing only the source providers that can emit each flow kind", () => {
  it("stablecoin_flow allows helius-api", () => {
    const txPayload = {
      ...BASE_COMMON_FIELDS,
      sourceQuality: {
        provider: "helius-api",
        freshness: "realtime",
        completeness: "full"
      } as OnChainFlowSourceQuality
    };
    expect(txPayload.sourceQuality.provider).toBe("helius-api");
  });

  it("cex_flow_proxy allows helius-api as attribution provider", () => {
    const cexPayload = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy" as const,
      quality: "proxy" as const,
      attributionConfidence: 0.75,
      attributionProvider: "helius-api",
      caveats: [] as readonly string[]
    };
    expect(cexPayload.attributionProvider).toBe("helius-api");
  });

  it("whale_swap allows birdeye-api as source provider", () => {
    const swapPayload = {
      ...BASE_COMMON_FIELDS,
      eventType: "whale_swap" as const,
      sourceQuality: {
        provider: "birdeye-api",
        freshness: "windowed",
        completeness: "full"
      } as OnChainFlowSourceQuality
    };
    expect(swapPayload.sourceQuality.provider).toBe("birdeye-api");
  });

  it("dex_net_flow allows birdeye-api as source provider", () => {
    const dexPayload = {
      ...BASE_COMMON_FIELDS,
      eventType: "dex_net_flow" as const,
      windowStartUnixMs: Date.now() - 900_000,
      windowEndUnixMs: Date.now(),
      buyVolumeUsdc: "250000",
      sellVolumeUsdc: "100000",
      netFlowUsdc: "150000",
      sourceQuality: {
        provider: "birdeye-api",
        freshness: "windowed",
        completeness: "full"
      } as OnChainFlowSourceQuality
    };
    expect(dexPayload.sourceQuality.provider).toBe("birdeye-api");
  });
});

describe("requiring explicit CEX proxy noise metadata", () => {
  it("CEX payload schema requires attributionConfidence, attributionProvider, and caveats", () => {
    const cexPayload = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy" as const,
      quality: "proxy" as const,
      attributionConfidence: 0.75,
      attributionProvider: "helius-api",
      caveats: ["estimated_from_related_addresses"] as readonly string[]
    };
    expect(typeof cexPayload.attributionConfidence).toBe("number");
    expect(typeof cexPayload.attributionProvider).toBe("string");
    expect(Array.isArray(cexPayload.caveats)).toBe(true);
  });

  it("rejects CEX payload without attributionConfidence", () => {
    const malformed = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy" as const,
      venue: "cex" as const,
      quality: "proxy" as const,
      attributionProvider: "helius-api",
      caveats: [] as readonly string[]
    };
    expect((malformed as unknown as CexFlowProxyPayloadV1).attributionConfidence).toBeUndefined();
  });
});

describe("not providing a motive field on any normalized flow payload", () => {
  it("WhaleSwapPayloadV1 has no motive field", () => {
    const swap: WhaleSwapPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "whale_swap",
      transactionSignature: "sig",
      eventIndex: 0,
      slot: 1,
      stablecoinOperation: "transfer"
    };
    expect("motive" in swap).toBe(false);
  });

  it("StablecoinFlowPayloadV1 has no motive field", () => {
    const stablecoin: StablecoinFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "stablecoin_flow",
      transactionSignature: "sig",
      eventIndex: 0,
      slot: 1,
      stablecoinOperation: "mint"
    };
    expect("motive" in stablecoin).toBe(false);
  });

  it("DexNetFlowPayloadV1 has no motive field", () => {
    const dex: DexNetFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "dex_net_flow",
      windowStartUnixMs: Date.now() - 900_000,
      windowEndUnixMs: Date.now(),
      buyVolumeUsdc: "100000",
      sellVolumeUsdc: "50000",
      netFlowUsdc: "50000"
    };
    expect("motive" in dex).toBe(false);
  });

  it("CexFlowProxyPayloadV1 has no motive field", () => {
    const cex: CexFlowProxyPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy",
      venue: "cex",
      quality: "proxy",
      attributionConfidence: 0.75,
      attributionProvider: "helius-api",
      caveats: []
    };
    expect("motive" in cex).toBe(false);
  });
});

describe("OnChainFlowPayloadV1 satisfies contracts", () => {
  it("WhaleSwapPayloadV1 satisfies OnChainFlowPayloadV1", () => {
    const swap: WhaleSwapPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "whale_swap",
      transactionSignature: "sig456",
      eventIndex: 1,
      slot: 1000,
      stablecoinOperation: "transfer"
    };
    const payload: OnChainFlowPayloadV1 = swap;
    expect(payload.eventType).toBe("whale_swap");
  });

  it("StablecoinFlowPayloadV1 satisfies OnChainFlowPayloadV1", () => {
    const sc: StablecoinFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "stablecoin_flow",
      transactionSignature: "sig789",
      eventIndex: 2,
      slot: 1001,
      stablecoinOperation: "burn"
    };
    const payload: OnChainFlowPayloadV1 = sc;
    expect(payload.eventType).toBe("stablecoin_flow");
  });

  it("DexNetFlowPayloadV1 satisfies OnChainFlowPayloadV1", () => {
    const dex: DexNetFlowPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "dex_net_flow",
      windowStartUnixMs: Date.now() - 900_000,
      windowEndUnixMs: Date.now(),
      buyVolumeUsdc: "200000",
      sellVolumeUsdc: "80000",
      netFlowUsdc: "120000"
    };
    const payload: OnChainFlowPayloadV1 = dex;
    expect(payload.eventType).toBe("dex_net_flow");
  });

  it("CexFlowProxyPayloadV1 satisfies OnChainFlowPayloadV1", () => {
    const cex: CexFlowProxyPayloadV1 = {
      ...BASE_COMMON_FIELDS,
      eventType: "cex_flow_proxy",
      venue: "cex",
      quality: "proxy",
      attributionConfidence: 0.8,
      attributionProvider: "helius-api",
      caveats: ["proxy_attribution"]
    };
    const payload: OnChainFlowPayloadV1 = cex;
    expect(payload.eventType).toBe("cex_flow_proxy");
  });
});
