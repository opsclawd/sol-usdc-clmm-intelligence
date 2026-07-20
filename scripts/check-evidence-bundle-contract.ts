import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const CONTRACT_DIR = fileURLToPath(
  new URL("../schemas/regime-engine/evidence-bundle.v1", import.meta.url)
);

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
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

  let allPassed = true;

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
