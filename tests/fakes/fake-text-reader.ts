import type { TextReader } from "../../src/ports/text-reader.js";

export class FakeTextReader implements TextReader {
  private readonly entries = new Map<string, string>();

  seed(path: string, content: string): void {
    this.entries.set(path, content);
  }

  async readText(path: string): Promise<string> {
    const entry = this.entries.get(path);
    if (entry === undefined) {
      const error = new Error(`FakeTextReader: missing ${path}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return entry;
  }
}
