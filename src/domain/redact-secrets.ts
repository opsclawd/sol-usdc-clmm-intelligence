const SECRET_KEYWORDS = [
  "api[_-]?key",
  "bearer\\s*token",
  "auth\\s*token",
  "bearer",
  "token",
  "auth",
  "secret"
];

/** Matches JSON object keys that likely hold secret material, for use as a JSON.stringify replacer. */
export const SECRET_KEY_PATTERN = /(api[_-]?key|bearer|token|auth|secret)/i;

/**
 * Redacts secret-looking values (e.g. `api_key=abc123`, `Bearer xyz`) and bare
 * secret keywords from free-text diagnostics/log output.
 */
export function redactSecretMentions(text: string): string {
  if (!text) return "";
  let redacted = text;
  for (const key of SECRET_KEYWORDS) {
    const valueRegex = new RegExp(`(${key})\\s*([=:]\\s*|\\s+)(\\S+)`, "gi");
    redacted = redacted.replace(valueRegex, "[REDACTED]");
  }
  for (const key of SECRET_KEYWORDS) {
    const keywordRegex = new RegExp(key, "gi");
    redacted = redacted.replace(keywordRegex, "[REDACTED]");
  }
  return redacted;
}

/** JSON.stringify replacer that redacts secret-named keys and secret mentions in string values. */
export function secretRedactingReplacer(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactSecretMentions(value);
  }
  return value;
}
