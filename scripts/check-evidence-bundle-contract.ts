import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT_DIR = fileURLToPath(
  new URL("../schemas/regime-engine/evidence-bundle.v1", import.meta.url)
);
const IGNORED_RELATIVE_PATHS = new Set(["provenance.json", "schema.sha256"]);

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

async function listVendoredAssetPaths(): Promise<string[]> {
  const entries = await readdir(CONTRACT_DIR, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      normalizeRelativePath(relative(CONTRACT_DIR, join(entry.parentPath, entry.name)))
    )
    .filter(
      (assetPath) =>
        !IGNORED_RELATIVE_PATHS.has(assetPath) && assetPath.split("/").at(-1) !== ".DS_Store"
    )
    .sort();
}

interface ProvenanceAsset {
  localPath: string;
  sha256: string;
}

interface Provenance {
  assets: ProvenanceAsset[];
}

async function main(): Promise<void> {
  console.log("Verifying EvidenceBundle v1 contract assets...\n");

  const provenancePath = join(CONTRACT_DIR, "provenance.json");
  const provenanceContent = await readFile(provenancePath, "utf-8");
  const provenance = JSON.parse(provenanceContent) as Provenance;
  const registeredPaths = new Set(
    provenance.assets.map((asset) => normalizeRelativePath(asset.localPath))
  );

  let allPassed = true;

  for (const assetPath of await listVendoredAssetPaths()) {
    if (!registeredPaths.has(assetPath)) {
      console.log(`  FAIL: ${assetPath} is present on disk but not registered in provenance.json`);
      allPassed = false;
    }
  }

  for (const asset of provenance.assets) {
    const assetPath = join(CONTRACT_DIR, asset.localPath);
    const content = await readFile(assetPath, "utf-8");
    const actualHash = computeSha256(content);

    if (actualHash === asset.sha256) {
      console.log(`  PASS: ${asset.localPath}`);
    } else {
      console.log(`  FAIL: ${asset.localPath}`);
      console.log(`    Expected: ${asset.sha256}`);
      console.log(`    Actual:   ${actualHash}`);
      allPassed = false;
    }
  }

  console.log("");

  if (allPassed) {
    console.log("All contract asset hashes verified successfully.");
    process.exit(0);
  } else {
    console.error("Contract asset hash verification FAILED.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error checking contract:", err);
  process.exit(1);
});
