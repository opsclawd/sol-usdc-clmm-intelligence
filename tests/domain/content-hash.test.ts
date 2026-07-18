import { describe, it, expect } from "vitest";
import { canonicalHash, canonicalizePayload } from "../../src/domain/content-hash.js";

describe("canonicalHash", () => {
  it("produces a stable SHA-256 hex digest for a simple object", async () => {
    const result = await canonicalHash({ b: 2, a: 1 });
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of key order", async () => {
    const hash1 = await canonicalHash({ a: 1, b: 2 });
    const hash2 = await canonicalHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it("produces the same hash regardless of nested key order", async () => {
    const hash1 = await canonicalHash({ outer: { a: 1, b: 2 } });
    const hash2 = await canonicalHash({ outer: { b: 2, a: 1 } });
    expect(hash1).toBe(hash2);
  });

  it("produces the same hash for deeply nested reordered objects", async () => {
    const hash1 = await canonicalHash({ x: { y: { z: 1, w: 2 }, q: 3 } });
    const hash2 = await canonicalHash({ x: { q: 3, y: { w: 2, z: 1 } } });
    expect(hash1).toBe(hash2);
  });

  it("produces the same hash for arrays with same nested object key order", async () => {
    const hash1 = await canonicalHash([{ a: 1, b: 2 }]);
    const hash2 = await canonicalHash([{ b: 2, a: 1 }]);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different payloads", async () => {
    const hash1 = await canonicalHash({ a: 1 });
    const hash2 = await canonicalHash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it("handles string payloads", async () => {
    const result = await canonicalHash("hello");
    expect(result).toHaveLength(64);
  });

  it("handles numeric payloads", async () => {
    const result = await canonicalHash(42);
    expect(result).toHaveLength(64);
  });

  it("handles null payload", async () => {
    const result = await canonicalHash(null);
    expect(result).toHaveLength(64);
  });
});

describe("canonicalizePayload", () => {
  it("canonical payload hash is the SHA-256 of the returned canonical string", async () => {
    const payload = { a: 1, b: 2 };
    const { payloadCanonical, payloadHash } = await canonicalizePayload(payload);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(payloadCanonical);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const hashArray = new Uint8Array(hashBuffer);
    const expectedHash = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(payloadHash).toBe(expectedHash);
  });

  it("canonical JSON sorts object keys recursively and preserves array order", async () => {
    const payload = { b: { d: 1, c: 2 }, a: [3, 2, 1] };
    const { payloadCanonical } = await canonicalizePayload(payload);
    expect(payloadCanonical).toBe('{"a":[3,2,1],"b":{"c":2,"d":1}}');
  });

  it("canonical JSON rejects undefined sparse arrays NaN Infinity and unsupported JSON values", async () => {
    await expect(canonicalizePayload(undefined)).rejects.toThrow();
    const sparseArr = [1];
    sparseArr[2] = 3;
    await expect(canonicalizePayload(sparseArr)).rejects.toThrow();
    await expect(canonicalizePayload([NaN])).rejects.toThrow();
    await expect(canonicalizePayload([Infinity])).rejects.toThrow();
    await expect(canonicalizePayload(Symbol("test"))).rejects.toThrow();
    await expect(canonicalizePayload(() => {})).rejects.toThrow();
  });
});
