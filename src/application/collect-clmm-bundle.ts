import type { HttpClient } from "../ports/http.js";
import type { JsonStore } from "../ports/json-store.js";
import type { EnvReader } from "../ports/env.js";
import type { ClmmBundle } from "../contracts/clmm-bundle.js";

export interface CollectClmmBundleDeps {
  http: HttpClient;
  jsonStore: JsonStore;
  env: EnvReader;
}

export const CLMM_BUNDLE_PATH = "data/latest-clmm-bundle.json";

function validateEnvelope(response: Record<string, unknown>): ClmmBundle {
  const bundle = response.bundle;

  if (!bundle || typeof bundle !== "object") {
    throw new Error("Response missing bundle field");
  }

  const b = bundle as Record<string, unknown>;

  if (b.pair !== "SOL/USDC") {
    throw new Error(`Expected pair SOL/USDC, got ${String(b.pair)}`);
  }

  if (!b.pool || typeof b.pool !== "object") {
    throw new Error("Bundle missing pool data");
  }

  if (!Array.isArray(b.positions)) {
    throw new Error("Bundle missing positions array");
  }

  if (b.source !== "orca") {
    throw new Error(`Expected source orca, got ${String(b.source)}`);
  }

  if (typeof b.observedAtUnixMs !== "number") {
    throw new Error("Bundle missing observedAtUnixMs");
  }

  if (!Array.isArray(b.alerts)) {
    throw new Error("Bundle missing alerts array");
  }

  if (!b.dataQuality || typeof b.dataQuality !== "object") {
    throw new Error("Bundle missing dataQuality");
  }

  const pool = b.pool as Record<string, unknown>;
  if (typeof pool.currentPrice !== "number") {
    throw new Error("Bundle pool missing currentPrice");
  }

  return b as unknown as ClmmBundle;
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
