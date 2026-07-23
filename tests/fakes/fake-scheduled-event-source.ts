import type {
  ScheduledEventSourcePort,
  ScheduledEventSourceRequest,
  ScheduledEventSourceSnapshot,
  ScheduledEventSourceError
} from "../../src/ports/scheduled-event-source.js";

export interface FakeScheduledEventSourceCall {
  request: ScheduledEventSourceRequest;
}

export class FakeScheduledEventSource implements ScheduledEventSourcePort {
  readonly calls: FakeScheduledEventSourceCall[] = [];
  private response: ScheduledEventSourceSnapshot | ScheduledEventSourceError | null = null;
  private shouldThrow = false;

  setResponse(response: ScheduledEventSourceSnapshot): void {
    this.response = response;
    this.shouldThrow = false;
  }

  setError(error: ScheduledEventSourceError): void {
    this.response = error;
    this.shouldThrow = true;
  }

  async collect(request: ScheduledEventSourceRequest): Promise<ScheduledEventSourceSnapshot> {
    this.calls.push({ request });

    if (this.shouldThrow && this.response !== null) {
      throw this.response;
    }

    if (this.response === null) {
      throw new Error("FakeScheduledEventSource: no response configured");
    }

    if (!this.shouldThrow) {
      return this.response as ScheduledEventSourceSnapshot;
    }

    throw new Error("FakeScheduledEventSource: invalid state");
  }
}
