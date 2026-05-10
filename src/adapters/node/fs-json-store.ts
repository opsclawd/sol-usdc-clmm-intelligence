import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JsonStore } from "../../ports/json-store.js";

export class FsJsonStore implements JsonStore {
  async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
