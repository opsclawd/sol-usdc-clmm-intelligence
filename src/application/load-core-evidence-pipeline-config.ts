import type { EnvReader } from "../ports/env.js";
import type { FamilyCoverage } from "../contracts/generated/evidence-bundle-v1.js";

export type IntelligenceEnvironment = "production" | "staging" | "development" | "test";

export type BundleFamilyId = keyof FamilyCoverage;

export interface CoreEvidencePipelineConfig {
  readonly positionIds: readonly string[];
  readonly poolId: string;
  readonly walletId: string;
  readonly codeVersion: string;
  readonly gitCommit: string;
  readonly environment: IntelligenceEnvironment;
  readonly configuredFamilies: ReadonlySet<BundleFamilyId>;
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

function optionalTrimmed(env: EnvReader, name: string): string | undefined {
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
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

const KNOWN_NEWS_SOURCES = new Set<string>(["crypto-news-api", "regulatory-monitor-api"]);

function getNewsSourceUrlEnvVar(source: string): string {
  return `${source.toUpperCase().replace(/-/g, "_")}_URL`;
}

function isNewsConfigured(env: EnvReader): boolean {
  const rawAllowlist = optionalTrimmed(env, "NEWS_SOURCE_ALLOWLIST");
  if (!rawAllowlist) {
    return false;
  }

  const names = rawAllowlist.split(",").map((name) => name.trim());
  if (names.length === 0) {
    return false;
  }

  const seen = new Set<string>();
  for (const name of names) {
    if (name.length === 0) {
      return false;
    }
    const lowerName = name.toLowerCase();
    if (!KNOWN_NEWS_SOURCES.has(lowerName)) {
      return false;
    }
    if (seen.has(lowerName)) {
      return false;
    }
    seen.add(lowerName);
  }

  if (seen.size === 0) {
    return false;
  }

  for (const sourceName of seen) {
    const urlVar = getNewsSourceUrlEnvVar(sourceName);
    const url = optionalTrimmed(env, urlVar);
    if (!url) {
      return false;
    }
  }

  return true;
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
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
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
    const val = optionalTrimmed(env, name);
    if (val) {
      validateHttpUrl(name, val);
    }
  }

  const configuredFamilies = new Set<BundleFamilyId>();

  configuredFamilies.add("deterministic");

  if (optionalTrimmed(env, "SUPPORT_RESISTANCE_API_URL")) {
    configuredFamilies.add("supportResistance");
  }

  if (
    optionalTrimmed(env, "BIRDEYE_FLOW_API_URL") &&
    optionalTrimmed(env, "BIRDEYE_API_KEY") &&
    optionalTrimmed(env, "HELIUS_FLOW_API_URL") &&
    optionalTrimmed(env, "HELIUS_API_KEY")
  ) {
    configuredFamilies.add("flows");
  }

  if (
    optionalTrimmed(env, "BINANCE_SOL_PERP_SYMBOL") &&
    optionalTrimmed(env, "DRIFT_DATA_API_BASE_URL") &&
    optionalTrimmed(env, "DRIFT_SOL_PERP_SYMBOL") &&
    optionalTrimmed(env, "DRIFT_SOL_PERP_MARKET_INDEX")
  ) {
    configuredFamilies.add("derivatives");
  }

  configuredFamilies.add("events");

  if (isNewsConfigured(env)) {
    configuredFamilies.add("newsRegulatory");
  }

  configuredFamilies.add("researchBrief");

  return Object.freeze({
    positionIds,
    poolId,
    walletId,
    codeVersion,
    gitCommit,
    environment,
    configuredFamilies: Object.freeze(configuredFamilies)
  });
}
