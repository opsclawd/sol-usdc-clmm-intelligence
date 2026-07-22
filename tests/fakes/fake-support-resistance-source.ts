import type {
  SupportResistanceSourcePort,
  SupportResistanceSourceRequest,
  SupportResistanceSourceSnapshot,
  SupportResistanceSourceError
} from "../../src/ports/support-resistance-source.js";

export interface FakeSupportResistanceSourceCall {
  request: SupportResistanceSourceRequest;
}

export class FakeSupportResistanceSource implements SupportResistanceSourcePort {
  readonly calls: FakeSupportResistanceSourceCall[] = [];
  private response: SupportResistanceSourceSnapshot | SupportResistanceSourceError | null = null;
  private shouldThrow = false;

  setResponse(response: SupportResistanceSourceSnapshot): void {
    this.response = response;
    this.shouldThrow = false;
  }

  setError(error: SupportResistanceSourceError): void {
    this.response = error;
    this.shouldThrow = true;
  }

  async collect(request: SupportResistanceSourceRequest): Promise<SupportResistanceSourceSnapshot> {
    this.calls.push({ request });

    if (this.shouldThrow && this.response !== null) {
      throw this.response;
    }

    if (this.response === null) {
      throw new Error("FakeSupportResistanceSource: no response configured");
    }

    if (!this.shouldThrow) {
      return this.response as SupportResistanceSourceSnapshot;
    }

    throw new Error("FakeSupportResistanceSource: invalid state");
  }
}
