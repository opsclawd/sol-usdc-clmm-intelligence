export function toCanonicalTimestamp(unixMs: number): string {
  return new Date(unixMs).toISOString();
}
