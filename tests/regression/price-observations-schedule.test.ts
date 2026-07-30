import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { CronConfig } from "../../src/contracts/cron-config.js";
import { collectPythPrice } from "../../src/application/collect-pyth-price.js";
import {
  calculateRealizedVolatility1h,
  type PriceObservation
} from "../../src/domain/derived-feature/volatility.js";
import type { OraclePricePayloadV1 } from "../../src/contracts/normalized-price-observation.js";
import {
  FakeClock,
  FakeEnv,
  FakeHttp,
  FakeJsonStore,
  FakeObservationRepo,
  FakeNormalizedObservationRepo
} from "../fakes/index.js";
import {
  SOL_USD_FEED_ID,
  makePythHermesEnvelope,
  makePythHermesPriceUpdate,
  makePythHermesParsedPrice
} from "../fixtures/pyth-price-update.js";

const PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";

const BASE_TIME = Date.parse("2026-07-30T12:00:00.000Z");
const PYTH_URL = `${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(SOL_USD_FEED_ID)}`;

function createPythDeps() {
  return {
    http: new FakeHttp(),
    jsonStore: new FakeJsonStore(),
    env: new FakeEnv({
      PYTH_HERMES_BASE_URL,
      PYTH_SOL_USD_FEED_ID: SOL_USD_FEED_ID
    }),
    clock: new FakeClock(new Date(BASE_TIME).toISOString()),
    rawObservationRepo: new FakeObservationRepo(),
    normalizedObservationRepo: new FakeNormalizedObservationRepo()
  };
}

async function collectTicks(observedAtOffsetsMs: readonly number[]) {
  const deps = createPythDeps();
  for (const [index, observedAtOffsetMs] of observedAtOffsetsMs.entries()) {
    const observedAtUnixMs = BASE_TIME + observedAtOffsetMs;
    deps.clock.set(new Date(observedAtUnixMs + 30_000).toISOString());
    deps.http.setResponse(PYTH_URL, {
      body: makePythHermesEnvelope({
        parsed: [
          makePythHermesPriceUpdate({
            slot: 123_456_789 + index,
            price: makePythHermesParsedPrice({
              publish_time: observedAtUnixMs / 1_000,
              price: String(175_000_000 + index * 100_000)
            })
          })
        ]
      })
    });

    const result = await collectPythPrice(deps, {
      runId: `scheduled-tick-${index}`,
      startedAtUnixMs: observedAtUnixMs + 30_000
    });
    expect(result.status).toBe("accepted");
  }

  const rows = await deps.normalizedObservationRepo.findBySource("pyth-hermes", "oracle_price", 0);
  return rows.map((row) => {
    const payload = row.payload as OraclePricePayloadV1;
    return {
      id: row.id,
      slot: payload.observedSource.slot,
      observedAtUnixMs: payload.observedSource.observedAtUnixMs,
      price: payload.priceData.price,
      receivedAtUnixMs: row.receivedAtUnixMs
    } satisfies PriceObservation;
  });
}

describe("price observations schedule regression", () => {
  it("registers exactly one canonical five-minute price observations job", async () => {
    const config = YAML.parse(await readFile("cron/jobs.yaml", "utf8")) as CronConfig;
    const matches = config.jobs.filter(({ name }) => name === "price-observations");

    expect(matches).toEqual([
      {
        name: "price-observations",
        cron: "*/5 * * * *",
        messageFile: "cron/routines/price-observations.md"
      }
    ]);
  });

  it("keeps the price observations routine to the collect:price command only", async () => {
    const routine = await readFile("cron/routines/price-observations.md", "utf8");
    expect(routine.trim()).toBe("Run `pnpm collect:price`.");
  });

  it("becomes available on the tenth healthy five-minute observation after 45 minutes", async () => {
    const observations = await collectTicks([
      0, 300_000, 600_000, 900_000, 1_200_000, 1_500_000, 1_800_000, 2_100_000, 2_400_000, 2_700_000
    ]);
    expect(observations).toHaveLength(10);
    expect(new Set(observations.map(({ observedAtUnixMs }) => observedAtUnixMs)).size).toBe(10);

    const anchor = BASE_TIME + 45 * 60_000;
    const warming = calculateRealizedVolatility1h(observations.slice(0, 9), anchor);
    expect(warming.status).toBe("UNAVAILABLE");
    expect(warming.reasons).toContain("insufficient_coverage");
    expect(warming.metadata.sampleCount).toBe(9);

    const available = calculateRealizedVolatility1h(observations, anchor);
    expect(available.status).toBe("AVAILABLE");
    expect(available.metadata.sampleCount).toBe(10);
    expect(
      Number(available.metadata.lastTimestampMs) - Number(available.metadata.firstTimestampMs)
    ).toBe(2_700_000);
    expect(available.metadata.maxGapMs).toBe(300_000);
  });

  it("keeps volatility unavailable when scheduled ticks leave a gap over ten minutes", async () => {
    const observations = await collectTicks([
      0, 300_000, 600_000, 900_000, 1_200_000, 1_500_000, 2_101_000, 2_400_000, 2_700_000, 3_000_000
    ]);
    const result = calculateRealizedVolatility1h(observations, BASE_TIME + 50 * 60_000);

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reasons).toContain("excessive_gap");
  });
});
