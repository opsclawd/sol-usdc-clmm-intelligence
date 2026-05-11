export async function canonicalHash(payload: unknown): Promise<string> {
  const canonical = serializeCanonical(payload);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serializeCanonical(payload: unknown): string {
  if (payload === null || typeof payload !== "object") {
    return JSON.stringify(payload);
  }
  const sorted = Object.entries(payload as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(Object.fromEntries(sorted));
}
