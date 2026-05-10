import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";

export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";

function validateEnvelope(response: Record<string, unknown>): Record<string, unknown> {
  const bundle = response.bundle;

  if (!bundle || typeof bundle !== "object") {
    throw new Error("Response missing bundle field");
  }

  const b = bundle as Record<string, unknown>;

  if (b.pair !== "SOL/USDC") {
    throw new Error(`Unexpected pair: ${b.pair}`);
  }

  if (!b.pool || typeof b.pool !== "object") {
    throw new Error("Bundle missing pool data");
  }

  if (!Array.isArray(b.positions)) {
    throw new Error("Bundle missing positions array");
  }

  return b;
}

export async function collectClmmBundle(deps: CollectClmmBundleDeps): Promise<void> {
  const { http, jsonStore, env } = deps;

  const base = env.get("CLMM_DATA_API_BASE");
  const apiKey = env.get("CLMM_INSIGHTS_API_KEY");
  const walletId = env.get("WALLET_PUBLIC_KEY");

  const normalized = base.replace(/\/$/, "");
  const url = `${normalized}/insights/sol-usdc/bundle/${walletId}`;

  const response = await http.getJson<Record<string, unknown>>(url, {
    "x-insights-api-key": apiKey
  });

  const bundle = validateEnvelope(response);

  await jsonStore.writeJson(CLMM_BUNDLE_PATH, bundle);
}
