import { describe, it, expect } from "vitest";
import { canonicalHash } from "../../src/domain/content-hash.js";

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
