import { describe, expect, it } from "vitest";
import { isProviderUnavailable } from "../../../src/domain/brief/provider-availability.js";

describe("isProviderUnavailable", () => {
  it("treats auth, quota, outage and transport failures as unavailable", () => {
    for (const message of [
      "LLM provider returned HTTP status 401",
      "LLM provider returned HTTP status 403",
      "LLM provider returned HTTP status 429",
      "LLM provider returned HTTP status 503",
      "LLM provider HTTP request failed: getaddrinfo ENOTFOUND",
      "LLM provider HTTP request failed: POST https://api.example.com/v1/chat/completions timed out",
      "Missing required LLM environment configuration (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)"
    ]) {
      expect(isProviderUnavailable(message), message).toBe(true);
    }
  });

  it("treats a bad model answer as a degraded response, not unavailability", () => {
    // The model replied — there is something to record, so the existing
    // degraded path applies rather than failing closed.
    for (const message of [
      "LLM provider returned malformed JSON",
      "LLM provider returned empty response content",
      "LLM provider output failed schema validation: summary: Required",
      "Unsupported or ungrounded evidence IDs: feat-x"
    ]) {
      expect(isProviderUnavailable(message), message).toBe(false);
    }
  });
});
