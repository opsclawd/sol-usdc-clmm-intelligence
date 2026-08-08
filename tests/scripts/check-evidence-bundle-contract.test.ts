import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ORIGINAL_CONTRACT_DIR = join(REPO_ROOT, "schemas/regime-engine/evidence-bundle.v1");

describe("check-evidence-bundle-contract", () => {
  let tempContractDir: string;

  beforeEach(() => {
    tempContractDir = mkdtempSync(join(tmpdir(), "evidence-bundle-contract-test-"));
    cpSync(ORIGINAL_CONTRACT_DIR, tempContractDir, { recursive: true });
  });

  afterEach(() => {
    if (tempContractDir) {
      rmSync(tempContractDir, { recursive: true, force: true });
    }
  });

  function runContractCheck(contractDir: string) {
    return spawnSync("pnpm", ["contract:evidence-bundle:check"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CONTRACT_DIR: contractDir },
      encoding: "utf8"
    });
  }

  it("fails when a nested vendored asset is absent from provenance.json", () => {
    const unregisteredAsset = join(
      tempContractDir,
      "fixtures/valid/unregistered-contract-test.json"
    );
    writeFileSync(unregisteredAsset, "{}\n", "utf8");

    const result = runContractCheck(tempContractDir);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "FAIL: fixtures/valid/unregistered-contract-test.json is present on disk but not registered in provenance.json"
    );
  });

  it("accepts the registered mirror when only approved metadata files are unregistered", () => {
    const dsStore = join(tempContractDir, "fixtures/.DS_Store");
    writeFileSync(dsStore, "test metadata", "utf8");

    const result = runContractCheck(tempContractDir);

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it("fails gracefully when a registered asset is missing from disk", () => {
    const registeredAsset = join(tempContractDir, "fixtures/valid/deterministic-only.json");
    unlinkSync(registeredAsset);

    const result = runContractCheck(tempContractDir);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("FAIL: fixtures/valid/deterministic-only.json");
    expect(output).toContain("File missing or unreadable on disk");
  });
});
