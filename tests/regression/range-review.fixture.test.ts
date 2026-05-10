import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generateRangeReview } from "../../src/application/generate-range-review.js";
import { FakeJsonStore, FakeClock } from "../fakes/index.js";

const FIXED_NOW = "2026-05-09T13:00:00.000Z";
async function loadJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("range-review regression", () => {
  it("matches the captured complete-data output", async () => {
    const jsonStore = new FakeJsonStore();
    jsonStore.seed(
      "data/latest-price-snapshot.json",
      await loadJson("tests/fixtures/snapshots/complete/latest-price-snapshot.json")
    );
    jsonStore.seed(
      "data/latest-pool-snapshot.json",
      await loadJson("tests/fixtures/snapshots/complete/latest-pool-snapshot.json")
    );
    jsonStore.seed(
      "data/latest-position-snapshot.json",
      await loadJson("tests/fixtures/snapshots/complete/latest-position-snapshot.json")
    );
    const result = await generateRangeReview({ jsonStore, clock: new FakeClock(FIXED_NOW) });
    expect(result).toEqual(await loadJson("tests/fixtures/expected/range-review-complete.json"));
  });

  it("matches the captured stale output", async () => {
    const result = await generateRangeReview({
      jsonStore: new FakeJsonStore(),
      clock: new FakeClock(FIXED_NOW)
    });
    expect(result).toEqual(await loadJson("tests/fixtures/expected/range-review-stale.json"));
  });
});
