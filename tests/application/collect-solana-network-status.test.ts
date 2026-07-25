import { describe, expect, it } from "vitest";
import { HttpRequestError } from "../../src/ports/http.js";
import { FakeHttp, FakeJsonStore, FakeEnv, FakeRetry } from "../fakes/index.js";
import { FakeObservationRepo } from "../fakes/fake-observation-repo.js";
import { FakeNormalizedObservationRepo } from "../fakes/fake-normalized-observation-repo.js";
import { collectSolanaNetworkStatus } from "../../src/application/collect-solana-network-status.js";
import type { CollectionRunContext } from "../../src/application/create-collection-run-context.js";

function createDeps(envOverrides: Record<string, string> = {}) {
  return {
    http: new FakeHttp(),
    retryControl: new FakeRetry([0, 0]),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      SOLANA_RPC_URL: "https://solana-mainnet.g.alchemy.com/v2/secret-api-key",
      SOLANA_RPC_API_KEY: "secret-bearer-token",
      INTELLIGENCE_CODE_VERSION: "v1.0.0",
      ...envOverrides
    }),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

const VALID_CONTEXT: CollectionRunContext = Object.freeze({
  runId: "run-test-123",
  startedAtUnixMs: 1773907200000
});

const RPC_URL = "https://solana-mainnet.g.alchemy.com/v2/secret-api-key";

describe("collectSolanaNetworkStatus behavioral invariants", () => {
  it("persists a 2xx response before validating and normalizing it", async () => {
    const deps = createDeps();
    const validResponseBody = [
      { jsonrpc: "2.0", id: "health", result: "ok" },
      { jsonrpc: "2.0", id: "slot", result: 250000000 }
    ];

    deps.http.setPostResponse(RPC_URL, {
      body: {
        status: 200,
        ok: true,
        body: validResponseBody,
        headers: {}
      }
    });

    const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);

    expect(result.status).toBe("accepted");
    expect(result.hasUsableEvidence).toBe(true);
    expect(result.rawObservationId).not.toBeNull();
    expect(result.normalizedCount).toBe(1);

    // Check raw repo
    const rawRow = await deps.rawObservationRepo.findById(result.rawObservationId!);
    expect(rawRow).toBeDefined();
    expect(rawRow!.parseStatus).toBe("parsed");
    expect(rawRow!.sourceRequestMeta).toEqual({
      method: "POST",
      host: "solana-mainnet.g.alchemy.com",
      network: "solana-mainnet-beta",
      rpcMethods: ["getHealth", "getSlot"],
      codeVersion: "v1.0.0",
      runId: "run-test-123"
    });

    // Check header was sent correctly
    expect(deps.http.postCalls[0]?.options?.headers).toEqual({
      Authorization: "Bearer secret-bearer-token"
    });

    // Check normalized repo
    const normRow = await deps.normalizedObservationRepo.findByRawObservation(
      result.rawObservationId!,
      "network_status"
    );
    expect(normRow).not.toBeNull();
    expect(normRow!.observationKind).toBe("network_status");
  });

  it("marks a persisted malformed RPC batch failed without normalized rows", async () => {
    const deps = createDeps();
    const malformedResponseBody = [
      { jsonrpc: "2.0", id: "health", result: "invalid_status" },
      { jsonrpc: "2.0", id: "slot", result: 250000000 }
    ];

    deps.http.setPostResponse(RPC_URL, {
      body: {
        status: 200,
        ok: true,
        body: malformedResponseBody,
        headers: {}
      }
    });

    const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);

    expect(result.status).toBe("malformed");
    expect(result.hasUsableEvidence).toBe(false);
    expect(result.rawObservationId).not.toBeNull();
    expect(result.normalizedCount).toBe(0);

    const rawRow = await deps.rawObservationRepo.findById(result.rawObservationId!);
    expect(rawRow).toBeDefined();
    expect(rawRow!.parseStatus).toBe("failed");

    const normRows = await deps.normalizedObservationRepo.findByRawObservation(
      result.rawObservationId!,
      "network_status"
    );
    expect(normRows).toBeNull();
  });

  it("replays identical network status without duplicate raw or normalized rows", async () => {
    const deps = createDeps();
    const validResponseBody = [
      { jsonrpc: "2.0", id: "health", result: "ok" },
      { jsonrpc: "2.0", id: "slot", result: 250000000 }
    ];

    deps.http.setPostResponse(RPC_URL, {
      body: {
        status: 200,
        ok: true,
        body: validResponseBody,
        headers: {}
      }
    });

    const firstResult = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
    expect(firstResult.status).toBe("accepted");

    const secondResult = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
    expect(secondResult.status).toBe("identical_replay");
    expect(secondResult.rawObservationId).toBe(firstResult.rawObservationId);
    expect(secondResult.normalizedCount).toBe(0);

    const rawRows = await deps.rawObservationRepo.findBySource("solana-rpc", 0);
    expect(rawRows).toHaveLength(1);
  });

  it("rejects a same-identity different-payload replay as conflict", async () => {
    const deps = createDeps();
    const firstResponseBody = [
      { jsonrpc: "2.0", id: "health", result: "ok" },
      { jsonrpc: "2.0", id: "slot", result: 250000000 }
    ];
    const secondResponseBody = [
      { jsonrpc: "2.0", id: "health", result: "ok" },
      { jsonrpc: "2.0", id: "slot", result: 250000001 }
    ];

    deps.http.setPostResponse(RPC_URL, {
      body: {
        status: 200,
        ok: true,
        body: firstResponseBody,
        headers: {}
      }
    });

    const firstResult = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
    expect(firstResult.status).toBe("accepted");

    deps.http.setPostResponse(RPC_URL, {
      body: {
        status: 200,
        ok: true,
        body: secondResponseBody,
        headers: {}
      }
    });

    const secondResult = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
    expect(secondResult.status).toBe("conflict");
    expect(secondResult.hasUsableEvidence).toBe(false);
    expect(secondResult.rawObservationId).toBe(firstResult.rawObservationId);
  });

  it("retries timeout network 408 429 and 5xx at most twice with the identical batch", async () => {
    const deps = createDeps();
    deps.http.postJsonRaw = async <T = unknown>(
      url: string,
      body: unknown,
      options?: import("../../src/ports/http.js").HttpRequestOptions
    ) => {
      deps.http.postCalls.push(options ? { url, body, options } : { url, body });
      if (deps.http.postCalls.length === 1) {
        throw new HttpRequestError("http_status", "Server Error", 503, true);
      }
      return {
        status: 200,
        ok: true,
        body: [
          { jsonrpc: "2.0", id: "health", result: "ok" },
          { jsonrpc: "2.0", id: "slot", result: 250000000 }
        ] as unknown as T,
        headers: {}
      };
    };

    const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);

    expect(result.status).toBe("accepted");
    expect(deps.http.postCalls).toHaveLength(2);
    expect(deps.retryControl.delays).toHaveLength(1);
    expect(deps.retryControl.delays[0]).toBe(25); // 25 + 0 * 25
  });

  it("does not retry permanent 4xx or malformed successful bodies", async () => {
    // 1. Permanent 4xx (e.g. 401 Unauthorized)
    {
      const deps = createDeps();
      deps.http.setPostResponse(RPC_URL, {
        error: new HttpRequestError("http_status", "Unauthorized", 401, false)
      });

      const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
      expect(result.status).toBe("unavailable");
      expect(deps.http.postCalls).toHaveLength(1);
    }

    // 2. Malformed successful 2xx body
    {
      const deps = createDeps();
      deps.http.setPostResponse(RPC_URL, {
        body: {
          status: 200,
          ok: true,
          body: { not: "an array" },
          headers: {}
        }
      });

      const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
      expect(result.status).toBe("malformed");
      expect(deps.http.postCalls).toHaveLength(1);
    }
  });

  it("returns degraded usable evidence for node-behind or slot-unavailable status", async () => {
    // 1. Node behind
    {
      const deps = createDeps();
      deps.http.setPostResponse(RPC_URL, {
        body: {
          status: 200,
          ok: true,
          body: [
            {
              jsonrpc: "2.0",
              id: "health",
              error: { code: -32005, message: "Node is behind", data: { numSlotsBehind: 15 } }
            },
            { jsonrpc: "2.0", id: "slot", result: 250000000 }
          ],
          headers: {}
        }
      });

      const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
      expect(result.status).toBe("degraded");
      expect(result.hasUsableEvidence).toBe(true);
      expect(result.warnings).toEqual(["node_behind"]);
    }

    // 2. Slot unavailable
    {
      const deps = createDeps();
      deps.http.setPostResponse(RPC_URL, {
        body: {
          status: 200,
          ok: true,
          body: [
            { jsonrpc: "2.0", id: "health", result: "ok" },
            { jsonrpc: "2.0", id: "slot", error: { code: -32000, message: "Slot unavailable" } }
          ],
          headers: {}
        }
      });

      const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
      expect(result.status).toBe("degraded");
      expect(result.hasUsableEvidence).toBe(true);
      expect(result.warnings).toEqual(["slot_unavailable"]);
    }
  });

  it("never exposes RPC credentials or credential-bearing paths in metadata or diagnostics", async () => {
    const deps = createDeps();
    deps.http.setPostResponse(RPC_URL, {
      error: new HttpRequestError("network", `Failed to connect to ${RPC_URL}`, null, true)
    });

    const result = await collectSolanaNetworkStatus(deps, VALID_CONTEXT);
    expect(result.status).toBe("network");
    expect(result.diagnostic).not.toContain("secret-api-key");
    expect(result.diagnostic).not.toContain("secret-bearer-token");
    expect(result.diagnostic).toContain("solana-mainnet.g.alchemy.com");
  });
});
