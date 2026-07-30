import type { EnvReader } from "../ports/env.js";

export type IntelligenceEnvironment = "production" | "staging" | "development" | "test";

export interface CoreEvidencePipelineConfig {
  readonly positionIds: readonly string[];
  readonly poolId: string;
  readonly walletId: string;
  readonly codeVersion: string;
  readonly gitCommit: string;
  readonly environment: IntelligenceEnvironment;
}

function requiredTrimmed(env: EnvReader, name: string): string {
  let val: string | undefined;
  try {
    val = env.getOptional(name);
  } catch {
    // fallback if getOptional throws
  }
  if (val === undefined) {
    try {
      val = env.get(name);
    } catch {
      val = undefined;
    }
  }
  const trimmed = val?.trim();
  if (!trimmed || trimmed.length === 0) {
    throw new Error(`Missing or empty required environment variable: ${name}`);
  }
  return trimmed;
}

function parsePositionIds(raw: string): readonly string[] {
  const trimmed = raw.trim();
  let items: string[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid position IDs format in INTELLIGENCE_POSITION_IDS");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid position IDs format in INTELLIGENCE_POSITION_IDS");
    }
    for (const item of parsed) {
      if (typeof item !== "string") {
        throw new Error("Invalid position IDs element in INTELLIGENCE_POSITION_IDS");
      }
    }
    items = parsed;
  } else {
    items = trimmed.split(",");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const entry = item.trim();
    if (entry.length > 0 && !seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }

  if (result.length === 0) {
    throw new Error("Empty normalized position IDs list in INTELLIGENCE_POSITION_IDS");
  }

  return Object.freeze(result);
}

function validateHttpUrl(name: string, raw: string): void {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL in ${name}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid URL protocol in ${name}`);
  }

  if (url.username || url.password) {
    throw new Error(`Credentials not allowed in URL in ${name}`);
  }
}

function parseEnvironment(raw: string): IntelligenceEnvironment {
  const trimmed = raw.trim();
  if (
    trimmed === "production" ||
    trimmed === "staging" ||
    trimmed === "development" ||
    trimmed === "test"
  ) {
    return trimmed;
  }
  throw new Error("Invalid environment in INTELLIGENCE_ENVIRONMENT");
}

function validateGitCommit(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[0-9a-f]{40}$/.test(trimmed)) {
    throw new Error("Invalid git commit in INTELLIGENCE_GIT_COMMIT");
  }
  return trimmed;
}

export function loadCoreEvidencePipelineConfig(env: EnvReader): CoreEvidencePipelineConfig {
  const rawPositionIds = requiredTrimmed(env, "INTELLIGENCE_POSITION_IDS");
  const positionIds = parsePositionIds(rawPositionIds);

  const poolId = requiredTrimmed(env, "WHIRLPOOL_ADDRESS");
  const walletId = requiredTrimmed(env, "WALLET_PUBLIC_KEY");
  const codeVersion = requiredTrimmed(env, "INTELLIGENCE_CODE_VERSION");
  const gitCommit = validateGitCommit(requiredTrimmed(env, "INTELLIGENCE_GIT_COMMIT"));
  const environment = parseEnvironment(requiredTrimmed(env, "INTELLIGENCE_ENVIRONMENT"));

  requiredTrimmed(env, "DATABASE_URL");

  const clmmDataApiBase = requiredTrimmed(env, "CLMM_DATA_API_BASE");
  validateHttpUrl("CLMM_DATA_API_BASE", clmmDataApiBase);

  requiredTrimmed(env, "CLMM_INSIGHTS_API_KEY");

  const pythHermesBaseUrl = requiredTrimmed(env, "PYTH_HERMES_BASE_URL");
  validateHttpUrl("PYTH_HERMES_BASE_URL", pythHermesBaseUrl);

  requiredTrimmed(env, "PYTH_SOL_USD_FEED_ID");

  const solanaRpcUrl = requiredTrimmed(env, "SOLANA_RPC_URL");
  validateHttpUrl("SOLANA_RPC_URL", solanaRpcUrl);

  const llmBaseUrl = requiredTrimmed(env, "LLM_BASE_URL");
  validateHttpUrl("LLM_BASE_URL", llmBaseUrl);

  requiredTrimmed(env, "LLM_API_KEY");
  requiredTrimmed(env, "LLM_MODEL");

  const regimeEngineBaseUrl = requiredTrimmed(env, "REGIME_ENGINE_BASE_URL");
  validateHttpUrl("REGIME_ENGINE_BASE_URL", regimeEngineBaseUrl);

  requiredTrimmed(env, "REGIME_ENGINE_AUTH_TOKEN");

  const optionalUrlVars = ["JUPITER_API_BASE", "ORCA_API_BASE"];
  for (const name of optionalUrlVars) {
    let val: string | undefined;
    try {
      val = env.getOptional(name);
    } catch {
      // ignore
    }
    if (val && val.trim().length > 0) {
      validateHttpUrl(name, val);
    }
  }

  return Object.freeze({
    positionIds,
    poolId,
    walletId,
    codeVersion,
    gitCommit,
    environment
  });
}
