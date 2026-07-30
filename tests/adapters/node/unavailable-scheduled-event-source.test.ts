import { describe, expect, it } from "vitest";
import { UnavailableScheduledEventSource } from "../../../src/adapters/node/unavailable-scheduled-event-source.js";

describe("UnavailableScheduledEventSource", () => {
  it("always reports deferred scheduled-event coverage as unavailable without HTTP", async () => {
    const source = new UnavailableScheduledEventSource(
      "scheduled_event collection is deferred pending source verification"
    );

    await expect(
      source.collect({
        pair: "SOL/USDC",
        fromUnixMs: 1,
        toUnixMs: 2
      })
    ).rejects.toEqual({
      kind: "unavailable",
      diagnostic: "scheduled_event collection is deferred pending source verification"
    });
  });
});
