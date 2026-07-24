import type {
  OnChainFlowSourcePort,
  OnChainFlowSourceRequest,
  OnChainFlowSourceSnapshot,
  OnChainFlowSourceError
} from "../../src/ports/on-chain-flow-source.js";

export interface FakeOnChainFlowSourceCall {
  request: OnChainFlowSourceRequest;
}

export class FakeOnChainFlowSource implements OnChainFlowSourcePort {
  readonly calls: FakeOnChainFlowSourceCall[] = [];
  private response: OnChainFlowSourceSnapshot | OnChainFlowSourceError | null = null;
  private shouldThrow = false;

  setResponse(response: OnChainFlowSourceSnapshot): void {
    this.response = response;
    this.shouldThrow = false;
  }

  setError(error: OnChainFlowSourceError): void {
    this.response = error;
    this.shouldThrow = true;
  }

  async collect(request: OnChainFlowSourceRequest): Promise<OnChainFlowSourceSnapshot> {
    this.calls.push({ request });

    if (this.shouldThrow && this.response !== null) {
      throw this.response;
    }

    if (this.response === null) {
      throw new Error("FakeOnChainFlowSource: no response configured");
    }

    if (!this.shouldThrow) {
      return this.response as OnChainFlowSourceSnapshot;
    }

    throw new Error("FakeOnChainFlowSource: invalid state");
  }
}
