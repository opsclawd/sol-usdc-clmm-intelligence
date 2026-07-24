import { describe, it, expect } from "vitest";
import {
  makeBoundedScheduledEventSnapshot,
  makeBoundedProtocolIncidentSnapshot,
  makeScheduledEventSnapshot,
  makeProtocolIncidentSnapshot,
  makeSourceQuality
} from "../../fixtures/context-events.js";
import {
  acceptScheduledEventSnapshot,
  acceptProtocolIncidentSnapshot
} from "../../../src/domain/context-events/validate.js";

describe("context-events/validate", () => {
  describe("acceptScheduledEventSnapshot", () => {
    it("accepts a valid scheduled event snapshot", () => {
      const snapshot = makeBoundedScheduledEventSnapshot();
      expect(() => acceptScheduledEventSnapshot(snapshot)).not.toThrow();
    });

    it("rejects a snapshot with non-string providerId", () => {
      const snapshot = makeBoundedScheduledEventSnapshot({ providerId: 123 as unknown as string });
      expect(() => acceptScheduledEventSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with invalid source", () => {
      const snapshot = makeBoundedScheduledEventSnapshot({
        source: "invalid-source" as "macro-calendar-api"
      });
      expect(() => acceptScheduledEventSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with non-finite sourceObservedAtUnixMs", () => {
      const snapshot = makeBoundedScheduledEventSnapshot({
        sourceObservedAtUnixMs: Infinity
      });
      expect(() => acceptScheduledEventSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with non-finite retrievedAtUnixMs", () => {
      const snapshot = makeBoundedScheduledEventSnapshot({
        retrievedAtUnixMs: NaN
      });
      expect(() => acceptScheduledEventSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with description exceeding max length", () => {
      const longDescription = "x".repeat(5001);
      const snapshot = makeScheduledEventSnapshot({ description: longDescription });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with title exceeding max length", () => {
      const longTitle = "x".repeat(1001);
      const snapshot = makeScheduledEventSnapshot({ title: longTitle });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with too many sourceReferences", () => {
      const snapshot = makeScheduledEventSnapshot({
        sourceReferences: Array(51).fill({ type: "test" })
      });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with too many affectedScope entries", () => {
      const snapshot = makeScheduledEventSnapshot({
        affectedScope: Array(101).fill("SOL")
      });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with invalid severity", () => {
      const snapshot = makeScheduledEventSnapshot({ severity: "INVALID" as "CRITICAL" });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with invalid status", () => {
      const snapshot = makeScheduledEventSnapshot({ status: "INVALID" as "SCHEDULED" });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with sourceQuality.reliability out of range", () => {
      const snapshot = makeScheduledEventSnapshot({
        sourceQuality: makeSourceQuality({ reliability: 1.5 })
      });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with non-array sourceReferences", () => {
      const snapshot = makeScheduledEventSnapshot({
        sourceReferences: "not-an-array" as unknown as unknown[]
      });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).toThrow();
    });
  });

  describe("acceptProtocolIncidentSnapshot", () => {
    it("accepts a valid protocol incident snapshot", () => {
      const snapshot = makeBoundedProtocolIncidentSnapshot();
      expect(() => acceptProtocolIncidentSnapshot(snapshot)).not.toThrow();
    });

    it("rejects a snapshot with non-string providerId", () => {
      const snapshot = makeBoundedProtocolIncidentSnapshot({
        providerId: 123 as unknown as string
      });
      expect(() => acceptProtocolIncidentSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with invalid source", () => {
      const snapshot = makeBoundedProtocolIncidentSnapshot({
        source: "invalid-source" as "solana-status-api"
      });
      expect(() => acceptProtocolIncidentSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with non-finite sourceObservedAtUnixMs", () => {
      const snapshot = makeBoundedProtocolIncidentSnapshot({
        sourceObservedAtUnixMs: -Infinity
      });
      expect(() => acceptProtocolIncidentSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with non-finite retrievedAtUnixMs", () => {
      const snapshot = makeBoundedProtocolIncidentSnapshot({
        retrievedAtUnixMs: Infinity
      });
      expect(() => acceptProtocolIncidentSnapshot(snapshot)).toThrow();
    });

    it("rejects a snapshot with description exceeding max length", () => {
      const longDescription = "x".repeat(5001);
      const snapshot = makeProtocolIncidentSnapshot({ description: longDescription });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with invalid severity", () => {
      const snapshot = makeProtocolIncidentSnapshot({ severity: "INVALID" as "CRITICAL" });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with invalid status", () => {
      const snapshot = makeProtocolIncidentSnapshot({ status: "INVALID" as "ACTIVE" });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with detectedAtUnixMs in the future", () => {
      const futureTime = Date.now() + 10000000;
      const snapshot = makeProtocolIncidentSnapshot({ detectedAtUnixMs: futureTime });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with resolvedAtUnixMs before detectedAtUnixMs", () => {
      const detected = Date.now() - 3600000;
      const resolved = detected - 7200000;
      const snapshot = makeProtocolIncidentSnapshot({
        detectedAtUnixMs: detected,
        resolvedAtUnixMs: resolved
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("rejects a snapshot with sourceQuality.confirmation out of enum", () => {
      const snapshot = makeProtocolIncidentSnapshot({
        sourceQuality: makeSourceQuality({ confirmation: "invalid" as "official" })
      });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).toThrow();
    });

    it("accepts a snapshot with null resolvedAtUnixMs (unresolved incident)", () => {
      const snapshot = makeProtocolIncidentSnapshot({ resolvedAtUnixMs: null });
      const bounded = makeBoundedProtocolIncidentSnapshot({ snapshot });
      expect(() => acceptProtocolIncidentSnapshot(bounded)).not.toThrow();
    });

    it("accepts a snapshot with null scheduledEndUnixMs for scheduled events", () => {
      const snapshot = makeScheduledEventSnapshot({ scheduledEndUnixMs: null });
      const bounded = makeBoundedScheduledEventSnapshot({ snapshot });
      expect(() => acceptScheduledEventSnapshot(bounded)).not.toThrow();
    });
  });
});
