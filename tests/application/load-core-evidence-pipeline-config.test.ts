import { describe, it, expect } from "vitest";
import { FakeEnv } from "../fakes/index.js";
import {
  loadCoreEvidencePipelineConfig,
  type BundleFamilyId
} from "../../src/application/load-core-evidence-pipeline-config.js";

const VALID_ENV: Record<string, string> = {
  INTELLIGENCE_POSITION_IDS: "pos-1, pos-2",
  WHIRLPOOL_ADDRESS: "whirlpool-123",
  WALLET_PUBLIC_KEY: "wallet-456",
  INTELLIGENCE_CODE_VERSION: "1.0.0",
  INTELLIGENCE_GIT_COMMIT: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  INTELLIGENCE_ENVIRONMENT: "production",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/intelligence",
  CLMM_DATA_API_BASE: "https://api.clmm.example.com",
  CLMM_INSIGHTS_API_KEY: "insights-key-123",
  PYTH_HERMES_BASE_URL: "https://hermes.pyth.network",
  PYTH_SOL_USD_FEED_ID: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
  LLM_BASE_URL: "https://api.openai.com",
  LLM_API_KEY: "llm-key-123",
  LLM_MODEL: "gpt-4o",
  REGIME_ENGINE_BASE_URL: "https://regime.example.com",
  REGIME_ENGINE_AUTH_TOKEN: "auth-token-123",
  SUPPORT_RESISTANCE_API_URL: "https://support.example.com",
  BIRDEYE_FLOW_API_URL: "https://birdeye.example.com",
  BIRDEYE_API_KEY: "birdeye-key-123",
  HELIUS_FLOW_API_URL: "https://helius.example.com",
  HELIUS_API_KEY: "helius-key-123",
  BINANCE_SOL_PERP_SYMBOL: "SOLUSDT",
  DRIFT_DATA_API_BASE_URL: "https://drift.example.com",
  DRIFT_SOL_PERP_SYMBOL: "SOL-PERP",
  DRIFT_SOL_PERP_MARKET_INDEX: "0",
  NEWS_SOURCE_ALLOWLIST: "crypto-news-api,regulatory-monitor-api",
  CRYPTO_NEWS_API_URL: "https://crypto-news.example.com",
  REGULATORY_MONITOR_API_URL: "https://regulatory.example.com"
};

describe("loadCoreEvidencePipelineConfig", () => {
  it("normalizes and de-duplicates comma-separated position IDs in first-seen order", () => {
    const env = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: "  pos-1  , pos-2, pos-1, , pos-3  "
    });
    const config = loadCoreEvidencePipelineConfig(env);
    expect(config.positionIds).toEqual(["pos-1", "pos-2", "pos-3"]);
    expect(Object.isFrozen(config.positionIds)).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts a JSON array of position IDs with the same normalization rules", () => {
    const env = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: '[" pos-1 ", "pos-2", "pos-1", "", "pos-3"]'
    });
    const config = loadCoreEvidencePipelineConfig(env);
    expect(config.positionIds).toEqual(["pos-1", "pos-2", "pos-3"]);
    expect(Object.isFrozen(config.positionIds)).toBe(true);
  });

  it("rejects an empty normalized position list", () => {
    const envComma = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: "   ,   "
    });
    expect(() => loadCoreEvidencePipelineConfig(envComma)).toThrow("INTELLIGENCE_POSITION_IDS");

    const envJson = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: '["", "  "]'
    });
    expect(() => loadCoreEvidencePipelineConfig(envJson)).toThrow("INTELLIGENCE_POSITION_IDS");
  });

  it("rejects malformed JSON and non-string JSON position entries", () => {
    const envMalformed = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: '["pos-1"'
    });
    expect(() => loadCoreEvidencePipelineConfig(envMalformed)).toThrow("INTELLIGENCE_POSITION_IDS");

    const envNonString = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: '[123, "pos-2"]'
    });
    expect(() => loadCoreEvidencePipelineConfig(envNonString)).toThrow("INTELLIGENCE_POSITION_IDS");

    const envObject = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_POSITION_IDS: '{"pos": "1"}'
    });
    expect(() => loadCoreEvidencePipelineConfig(envObject)).toThrow("INTELLIGENCE_POSITION_IDS");
  });

  it("rejects missing or whitespace-only identity provenance and stage configuration", () => {
    const requiredVars = [
      "INTELLIGENCE_POSITION_IDS",
      "WHIRLPOOL_ADDRESS",
      "WALLET_PUBLIC_KEY",
      "INTELLIGENCE_CODE_VERSION",
      "INTELLIGENCE_GIT_COMMIT",
      "INTELLIGENCE_ENVIRONMENT",
      "DATABASE_URL",
      "CLMM_DATA_API_BASE",
      "CLMM_INSIGHTS_API_KEY",
      "PYTH_HERMES_BASE_URL",
      "PYTH_SOL_USD_FEED_ID",
      "SOLANA_RPC_URL",
      "LLM_BASE_URL",
      "LLM_API_KEY",
      "LLM_MODEL",
      "REGIME_ENGINE_BASE_URL",
      "REGIME_ENGINE_AUTH_TOKEN"
    ];

    for (const varName of requiredVars) {
      // Test missing
      const missingEnvMap = { ...VALID_ENV };
      delete missingEnvMap[varName];
      const missingEnv = new FakeEnv(missingEnvMap);
      expect(() => loadCoreEvidencePipelineConfig(missingEnv)).toThrow(varName);

      // Test whitespace-only
      const whitespaceEnv = new FakeEnv({
        ...VALID_ENV,
        [varName]: "   "
      });
      expect(() => loadCoreEvidencePipelineConfig(whitespaceEnv)).toThrow(varName);
    }
  });

  it("accepts exactly 64 lowercase hexadecimal git commit provenance and rejects other forms", () => {
    const config = loadCoreEvidencePipelineConfig(new FakeEnv(VALID_ENV));
    expect(config.gitCommit).toBe(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );

    const invalidCommits = [
      "0123456789abcdef0123456789abcdef01234567",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0",
      "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"
    ];

    for (const gitCommit of invalidCommits) {
      const env = new FakeEnv({
        ...VALID_ENV,
        INTELLIGENCE_GIT_COMMIT: gitCommit
      });
      expect(() => loadCoreEvidencePipelineConfig(env)).toThrow(
        "Invalid git commit in INTELLIGENCE_GIT_COMMIT"
      );
    }
  });

  it("accepts only production staging development or test environments", () => {
    const validEnvs = ["production", "staging", "development", "test"] as const;
    for (const envVal of validEnvs) {
      const env = new FakeEnv({
        ...VALID_ENV,
        INTELLIGENCE_ENVIRONMENT: envVal
      });
      const config = loadCoreEvidencePipelineConfig(env);
      expect(config.environment).toBe(envVal);
    }

    const invalidEnv = new FakeEnv({
      ...VALID_ENV,
      INTELLIGENCE_ENVIRONMENT: "invalid_env"
    });
    expect(() => loadCoreEvidencePipelineConfig(invalidEnv)).toThrow("INTELLIGENCE_ENVIRONMENT");
  });

  it("rejects invalid credential-bearing or non-HTTP stage URLs", () => {
    // Non-HTTP
    const nonHttp = new FakeEnv({
      ...VALID_ENV,
      CLMM_DATA_API_BASE: "ftp://api.clmm.example.com"
    });
    expect(() => loadCoreEvidencePipelineConfig(nonHttp)).toThrow("CLMM_DATA_API_BASE");

    // Credential-bearing
    const credentials = new FakeEnv({
      ...VALID_ENV,
      SOLANA_RPC_URL: "https://user:pass@api.mainnet-beta.solana.com"
    });
    expect(() => loadCoreEvidencePipelineConfig(credentials)).toThrow("SOLANA_RPC_URL");

    // Malformed URL
    const malformed = new FakeEnv({
      ...VALID_ENV,
      REGIME_ENGINE_BASE_URL: "not-a-url"
    });
    expect(() => loadCoreEvidencePipelineConfig(malformed)).toThrow("REGIME_ENGINE_BASE_URL");

    // Optional stage URL invalid when present
    const invalidOptional = new FakeEnv({
      ...VALID_ENV,
      JUPITER_API_BASE: "ftp://quote-api.jup.ag"
    });
    expect(() => loadCoreEvidencePipelineConfig(invalidOptional)).toThrow("JUPITER_API_BASE");

    // Optional stage URL valid when present
    const validOptional = new FakeEnv({
      ...VALID_ENV,
      JUPITER_API_BASE: "https://quote-api.jup.ag"
    });
    expect(() => loadCoreEvidencePipelineConfig(validOptional)).not.toThrow();
  });

  it("marks all families configured when every collector requirement is present", () => {
    const config = loadCoreEvidencePipelineConfig(new FakeEnv(VALID_ENV));
    expect(config.configuredFamilies).toEqual(
      new Set([
        "deterministic",
        "supportResistance",
        "flows",
        "derivatives",
        "events",
        "newsRegulatory",
        "researchBrief"
      ])
    );
  });

  it("marks optional families unconfigured when any required collector setting is blank", () => {
    const allFamilies = new Set([
      "deterministic",
      "supportResistance",
      "flows",
      "derivatives",
      "events",
      "newsRegulatory",
      "researchBrief"
    ]);

    const cases: Array<{ varName: string; family: BundleFamilyId }> = [
      { varName: "SUPPORT_RESISTANCE_API_URL", family: "supportResistance" },
      { varName: "BIRDEYE_FLOW_API_URL", family: "flows" },
      { varName: "BIRDEYE_API_KEY", family: "flows" },
      { varName: "HELIUS_FLOW_API_URL", family: "flows" },
      { varName: "HELIUS_API_KEY", family: "flows" },
      { varName: "BINANCE_SOL_PERP_SYMBOL", family: "derivatives" },
      { varName: "DRIFT_DATA_API_BASE_URL", family: "derivatives" },
      { varName: "DRIFT_SOL_PERP_SYMBOL", family: "derivatives" },
      { varName: "DRIFT_SOL_PERP_MARKET_INDEX", family: "derivatives" }
    ];

    for (const { varName, family } of cases) {
      // Test missing
      const envMissingMap = { ...VALID_ENV };
      delete envMissingMap[varName];
      const configMissing = loadCoreEvidencePipelineConfig(new FakeEnv(envMissingMap));
      const expectedMissing = new Set(allFamilies);
      expectedMissing.delete(family);
      expect(configMissing.configuredFamilies).toEqual(expectedMissing);

      // Test blank / whitespace
      const envBlankMap = { ...VALID_ENV, [varName]: "   " };
      const configBlank = loadCoreEvidencePipelineConfig(new FakeEnv(envBlankMap));
      expect(configBlank.configuredFamilies).toEqual(expectedMissing);
    }
  });

  it("keeps events configured through the default Solana Status source", () => {
    const envMap = { ...VALID_ENV };
    delete envMap["SOLANA_STATUS_API_URL"];
    delete envMap["MACRO_CALENDAR_API_URL"];
    delete envMap["MACRO_CALENDAR_API_KEY"];
    const config = loadCoreEvidencePipelineConfig(new FakeEnv(envMap));
    expect(config.configuredFamilies.has("events")).toBe(true);
  });

  it("requires a known configured news allowlist entry before marking news configured", () => {
    // Empty allowlist (whitespace or missing)
    const envEmpty = new FakeEnv({
      ...VALID_ENV,
      NEWS_SOURCE_ALLOWLIST: "   "
    });
    expect(loadCoreEvidencePipelineConfig(envEmpty).configuredFamilies.has("newsRegulatory")).toBe(
      false
    );

    const envMissingMap = { ...VALID_ENV };
    delete envMissingMap["NEWS_SOURCE_ALLOWLIST"];
    const envMissing = new FakeEnv(envMissingMap);
    expect(
      loadCoreEvidencePipelineConfig(envMissing).configuredFamilies.has("newsRegulatory")
    ).toBe(false);

    // Unknown source
    const envUnknown = new FakeEnv({
      ...VALID_ENV,
      NEWS_SOURCE_ALLOWLIST: "unknown-source"
    });
    expect(
      loadCoreEvidencePipelineConfig(envUnknown).configuredFamilies.has("newsRegulatory")
    ).toBe(false);

    // Duplicate source
    const envDuplicate = new FakeEnv({
      ...VALID_ENV,
      NEWS_SOURCE_ALLOWLIST: "crypto-news-api, crypto-news-api"
    });
    expect(
      loadCoreEvidencePipelineConfig(envDuplicate).configuredFamilies.has("newsRegulatory")
    ).toBe(false);

    // Selected source without URL
    const envNoUrlMap: Record<string, string> = {
      ...VALID_ENV,
      NEWS_SOURCE_ALLOWLIST: "crypto-news-api"
    };
    delete envNoUrlMap["CRYPTO_NEWS_API_URL"];
    const envNoUrl = new FakeEnv(envNoUrlMap);
    expect(loadCoreEvidencePipelineConfig(envNoUrl).configuredFamilies.has("newsRegulatory")).toBe(
      false
    );

    // Valid crypto-news-api URL without an API key -> news IS configured
    const envNoApiKeyMap: Record<string, string> = {
      ...VALID_ENV,
      NEWS_SOURCE_ALLOWLIST: "crypto-news-api",
      CRYPTO_NEWS_API_URL: "https://crypto-news.example.com"
    };
    delete envNoApiKeyMap["CRYPTO_NEWS_API_KEY"];
    const envNoApiKey = new FakeEnv(envNoApiKeyMap);
    expect(
      loadCoreEvidencePipelineConfig(envNoApiKey).configuredFamilies.has("newsRegulatory")
    ).toBe(true);
  });
});
