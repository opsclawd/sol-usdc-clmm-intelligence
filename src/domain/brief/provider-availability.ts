/**
 * Distinguish "the provider could not be reached or authenticated" from "the
 * model answered badly".
 *
 * The first is a configuration or infrastructure fault. Synthesising a brief for
 * it publishes an error string as `summary`, which consumers render as analysis
 * — a misconfiguration masquerading as content (see #171, where every bundle
 * carried "LLM provider returned HTTP status 401" as its research summary).
 *
 * The second is a genuine degraded answer and keeps the existing degraded path:
 * the model responded, so there is something to record.
 */
const PROVIDER_UNAVAILABLE_SIGNATURES: ReadonlyArray<RegExp> = [
  /returned HTTP status (401|403)\b/i, // auth: bad or missing credential
  /returned HTTP status 5\d\d\b/i, // provider-side outage
  /returned HTTP status 429\b/i, // quota or rate limit exhausted
  /HTTP request failed/i, // transport: DNS, TLS, connection refused
  /timed out/i,
  /Missing required LLM environment configuration/i,
  /provider unavailable/i
];

export function isProviderUnavailable(message: string): boolean {
  return PROVIDER_UNAVAILABLE_SIGNATURES.some((re) => re.test(message));
}
