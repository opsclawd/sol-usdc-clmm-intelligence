import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTRACT_DIR = join(REPO_ROOT, "schemas/regime-engine/evidence-bundle.v1");
const UNREGISTERED_ASSET = join(CONTRACT_DIR, "fixtures/valid/unregistered-contract-test.json");
const DS_STORE = join(CONTRACT_DIR, "fixtures/.DS_Store");

function runContractCheck() {
  return spawnSync("pnpm", ["contract:evidence-bundle:check"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
}

afterEach(() => {
  rmSync(UNREGISTERED_ASSET, { force: true });
  rmSync(DS_STORE, { force: true });
});

describe("check-evidence-bundle-contract", () => {
  it("fails when a nested vendored asset is absent from provenance.json", () => {
    writeFileSync(UNREGISTERED_ASSET, "{}\n", "utf8");

    const result = runContractCheck();
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "FAIL: fixtures/valid/unregistered-contract-test.json is present on disk but not registered in provenance.json"
    );
  });

  it("accepts the registered mirror when only approved metadata files are unregistered", () => {
    writeFileSync(DS_STORE, "test metadata", "utf8");

    const result = runContractCheck();

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
