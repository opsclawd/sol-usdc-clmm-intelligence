export interface CanonicalPayload {
  payloadCanonical: string;
  payloadHash: string;
}

async function sha256Hex(encoded: ArrayBuffer): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isSerializable(value: unknown): boolean {
  if (value === null) return true;
  if (value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    return true;
  }
  if (typeof value === "string") return true;
  if (typeof value === "bigint") return false;
  if (typeof value === "symbol") return false;
  if (typeof value === "function") return false;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return false;
      return value.every(isSerializable);
    }
    return Object.values(value as Record<string, unknown>).every(isSerializable);
  }
  return false;
}

function serializeCanonical(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "null";
  }
  if (typeof payload !== "object") {
    return JSON.stringify(payload);
  }
  if (Array.isArray(payload)) {
    return "[" + payload.map(serializeCanonical).join(",") + "]";
  }
  const sorted = Object.entries(payload as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, serializeCanonical(v)]);
  return "{" + sorted.map(([k, v]) => `${JSON.stringify(k as string)}:${v}`).join(",") + "}";
}

export async function canonicalizePayload(payload: unknown): Promise<CanonicalPayload> {
  if (!isSerializable(payload)) {
    throw new Error("Payload contains values that cannot be represented in JSON");
  }
  const payloadCanonical = serializeCanonical(payload);
  const encoded = new TextEncoder().encode(payloadCanonical);
  const payloadHash = await sha256Hex(encoded.buffer);
  return { payloadCanonical, payloadHash };
}

export async function canonicalHash(payload: unknown): Promise<string> {
  const { payloadHash } = await canonicalizePayload(payload);
  return payloadHash;
}
