import { readFile } from "node:fs/promises";
import type { TextReader } from "../../ports/text-reader.js";

export class FsTextReader implements TextReader {
  async readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}
