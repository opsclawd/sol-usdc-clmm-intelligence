import type {
  ScheduledEventSourceError,
  ScheduledEventSourcePort,
  ScheduledEventSourceRequest,
  ScheduledEventSourceSnapshot
} from "../../ports/scheduled-event-source.js";

export class UnavailableScheduledEventSource implements ScheduledEventSourcePort {
  constructor(private readonly diagnostic: string) {}

  async collect(_request: ScheduledEventSourceRequest): Promise<ScheduledEventSourceSnapshot> {
    void _request;
    throw { kind: "unavailable", diagnostic: this.diagnostic } satisfies ScheduledEventSourceError;
  }
}
