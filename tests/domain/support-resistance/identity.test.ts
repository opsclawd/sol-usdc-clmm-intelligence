import { describe, it, expect } from "vitest";
import {
  makeSupportResistanceRawSnapshot,
  makeSupportResistancePointClaim
} from "../../fixtures/support-resistance.js";
import { acceptSupportResistanceSnapshot } from "../../../src/domain/support-resistance/validate.js";
import { normalizeSupportResistanceClaims } from "../../../src/domain/support-resistance/normalize.js";
import {
  deriveSupportResistanceSourceObservationKey,
  deriveSupportResistanceEquivalenceKey,
  type SupportResistanceSourceObservationIdentity
} from "../../../src/domain/support-resistance/identity.js";

describe("deriveSupportResistanceSourceObservationKey", () => {
  it("derives a source observation key from provider and provider run identity", async () => {
    const identity: SupportResistanceSourceObservationIdentity = {
      providerId: "technical-analysis-api",
      providerRunId: "run-001"
    };

    const key = await deriveSupportResistanceSourceObservationKey(identity);

    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("produces identical keys for same provider and run", async () => {
    const identity1: SupportResistanceSourceObservationIdentity = {
      providerId: "technical-analysis-api",
      providerRunId: "run-001"
    };
    const identity2: SupportResistanceSourceObservationIdentity = {
      providerId: "technical-analysis-api",
      providerRunId: "run-001"
    };

    const key1 = await deriveSupportResistanceSourceObservationKey(identity1);
    const key2 = await deriveSupportResistanceSourceObservationKey(identity2);

    expect(key1).toBe(key2);
  });

  it("produces different keys for different provider runs", async () => {
    const identity1: SupportResistanceSourceObservationIdentity = {
      providerId: "technical-analysis-api",
      providerRunId: "run-001"
    };
    const identity2: SupportResistanceSourceObservationIdentity = {
      providerId: "technical-analysis-api",
      providerRunId: "run-002"
    };

    const key1 = await deriveSupportResistanceSourceObservationKey(identity1);
    const key2 = await deriveSupportResistanceSourceObservationKey(identity2);

    expect(key1).not.toBe(key2);
  });

  it("does not include collection time in key", async () => {
    const snapshot1 = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1705315800000,
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });
    const snapshot2 = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      asOfUnixMs: 1800000000000,
      claims: [makeSupportResistancePointClaim(150.5, "RESISTANCE")]
    });

    const bounded1 = acceptSupportResistanceSnapshot(snapshot1);
    const bounded2 = acceptSupportResistanceSnapshot(snapshot2);

    const identity1: SupportResistanceSourceObservationIdentity = {
      providerId: bounded1.providerId,
      providerRunId: bounded1.providerRunId
    };
    const identity2: SupportResistanceSourceObservationIdentity = {
      providerId: bounded2.providerId,
      providerRunId: bounded2.providerRunId
    };

    const key1 = await deriveSupportResistanceSourceObservationKey(identity1);
    const key2 = await deriveSupportResistanceSourceObservationKey(identity2);

    expect(key1).toBe(key2);
  });
});

describe("deriveSupportResistanceEquivalenceKey", () => {
  it("groups only materially equivalent claims from the same provider run", async () => {
    const snapshot = makeSupportResistanceRawSnapshot({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      claims: [
        makeSupportResistancePointClaim(150.5, "RESISTANCE"),
        makeSupportResistancePointClaim(150.5, "RESISTANCE")
      ]
    });

    const bounded = acceptSupportResistanceSnapshot(snapshot);
    const normalized = normalizeSupportResistanceClaims(bounded);

    const keys = await Promise.all(
      normalized.accepted.map((claim) =>
        deriveSupportResistanceEquivalenceKey({
          providerId: bounded.providerId,
          providerRunId: bounded.providerRunId,
          pair: bounded.pair,
          evidenceSide: claim.evidenceSide,
          levelType: claim.levelType,
          levelUsdcPerSol: (claim as { levelUsdcPerSol?: number }).levelUsdcPerSol,
          zoneLowerUsdcPerSol: (claim as { zoneLowerUsdcPerSol?: number }).zoneLowerUsdcPerSol,
          zoneUpperUsdcPerSol: (claim as { zoneUpperUsdcPerSol?: number }).zoneUpperUsdcPerSol,
          timeframe: claim.timeframe,
          thesisCodes: claim.thesisCodes
        })
      )
    );

    expect(keys[0]).toBe(keys[1]);
  });

  it("keeps point and zone assertions distinct", async () => {
    const pointKey = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    const zoneKey = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "zone",
      levelUsdcPerSol: undefined,
      zoneLowerUsdcPerSol: 149.0,
      zoneUpperUsdcPerSol: 151.0,
      timeframe: "1h",
      thesisCodes: []
    });

    expect(pointKey).not.toBe(zoneKey);
  });

  it("keeps different sides distinct", async () => {
    const supportKey = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "SUPPORT",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    const resistanceKey = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    expect(supportKey).not.toBe(resistanceKey);
  });

  it("keeps different timeframes distinct", async () => {
    const key1 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    const key2 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "4h",
      thesisCodes: []
    });

    expect(key1).not.toBe(key2);
  });

  it("keeps different thesis codes distinct", async () => {
    const key1 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: ["breakout"]
    });

    const key2 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: ["rejection"]
    });

    expect(key1).not.toBe(key2);
  });

  it("keeps different providers distinct", async () => {
    const key1 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    const key2 = await deriveSupportResistanceEquivalenceKey({
      providerId: "other-provider",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    expect(key1).not.toBe(key2);
  });

  it("keeps different runs distinct", async () => {
    const key1 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    const key2 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-002",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: []
    });

    expect(key1).not.toBe(key2);
  });

  it("canonicalizes thesis codes by sorting", async () => {
    const key1 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: ["breakout", "rejection"]
    });

    const key2 = await deriveSupportResistanceEquivalenceKey({
      providerId: "technical-analysis-api",
      providerRunId: "run-001",
      pair: "SOL/USDC",
      evidenceSide: "RESISTANCE",
      levelType: "point",
      levelUsdcPerSol: 150.0,
      zoneLowerUsdcPerSol: undefined,
      zoneUpperUsdcPerSol: undefined,
      timeframe: "1h",
      thesisCodes: ["rejection", "breakout"]
    });

    expect(key1).toBe(key2);
  });
});
