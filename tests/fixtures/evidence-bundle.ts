import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HashVector {
  name: string;
  payload: unknown;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}

export interface BundleHashVector {
  name: string;
  payload: object;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}

const CONTRACT_DIR = new URL("../../schemas/regime-engine/evidence-bundle.v1", import.meta.url)
  .pathname;

export async function loadValidFixture(name: string): Promise<object> {
  const fixturePath = join(CONTRACT_DIR, "fixtures", "valid", `${name}.json`);
  const content = await readFile(fixturePath, "utf-8");
  return JSON.parse(content) as object;
}

export async function loadInvalidFixtures(): Promise<Array<{ name: string; payload: object }>> {
  const fixturesDir = join(CONTRACT_DIR, "fixtures", "invalid");
  const fs = await import("node:fs");
  const files = await fs.promises.readdir(fixturesDir);
  const fixtures: Array<{ name: string; payload: object }> = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      const content = await readFile(join(fixturesDir, file), "utf-8");
      fixtures.push({
        name: file.replace(".json", ""),
        payload: JSON.parse(content) as object
      });
    }
  }

  return fixtures;
}

export async function loadHashVectors(): Promise<HashVector[]> {
  const hashVectorsPath = join(CONTRACT_DIR, "hash-vectors.json");
  const content = await readFile(hashVectorsPath, "utf-8");
  const data = JSON.parse(content) as { vectors: HashVector[] };
  return data.vectors;
}

import { createHash } from "node:crypto";

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function canonicalizePayload(payload: unknown): string {
  return canonicalizeValue(payload);
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize non-finite number");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeValue).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalizeValue(obj[k]));
    return "{" + entries.join(",") + "}";
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}
