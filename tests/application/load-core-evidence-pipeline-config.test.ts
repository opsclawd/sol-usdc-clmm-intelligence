import { describe, it, expect } from "vitest";
import { FakeEnv } from "../fakes/index.js";
import { loadCoreEvidencePipelineConfig } from "../../src/application/load-core-evidence-pipeline-config.js";

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
  REGIME_ENGINE_AUTH_TOKEN: "auth-token-123"
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
});
