import type {
  ProtocolIncidentSourcePort,
  ProtocolIncidentSourceRequest,
  ProtocolIncidentSourceSnapshot,
  ProtocolIncidentSourceError
} from "../../src/ports/protocol-incident-source.js";

export interface FakeProtocolIncidentSourceCall {
  request: ProtocolIncidentSourceRequest;
}

export class FakeProtocolIncidentSource implements ProtocolIncidentSourcePort {
  readonly calls: FakeProtocolIncidentSourceCall[] = [];
  private response: ProtocolIncidentSourceSnapshot | ProtocolIncidentSourceError | null = null;
  private shouldThrow = false;

  setResponse(response: ProtocolIncidentSourceSnapshot): void {
    this.response = response;
    this.shouldThrow = false;
  }

  setError(error: ProtocolIncidentSourceError): void {
    this.response = error;
    this.shouldThrow = true;
  }

  async collect(request: ProtocolIncidentSourceRequest): Promise<ProtocolIncidentSourceSnapshot> {
    this.calls.push({ request });

    if (this.shouldThrow && this.response !== null) {
      throw this.response;
    }

    if (this.response === null) {
      throw new Error("FakeProtocolIncidentSource: no response configured");
    }

    if (!this.shouldThrow) {
      return this.response as ProtocolIncidentSourceSnapshot;
    }

    throw new Error("FakeProtocolIncidentSource: invalid state");
  }
}
