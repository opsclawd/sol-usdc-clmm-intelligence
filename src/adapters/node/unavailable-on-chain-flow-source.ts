import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceError
} from "../../ports/on-chain-flow-source.js";

export class UnavailableOnChainFlowSource implements OnChainFlowSourcePort {
  constructor(private readonly diagnostic: string) {}

  async collect(_request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot> {
    void _request;
    throw { kind: "unavailable", diagnostic: this.diagnostic } satisfies OnChainFlowSourceError;
  }
}
