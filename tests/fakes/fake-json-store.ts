import type { JsonStore } from '../../src/ports/json-store.js';

export class FakeJsonStore implements JsonStore {
  readonly writes: Array<{ path: string; value: unknown }> = [];
  private readonly entries = new Map<string, unknown>();

  seed(path: string, value: unknown): void {
    this.entries.set(path, value);
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    return (this.entries.get(path) as T | undefined) ?? undefined;
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    this.writes.push({ path, value });
    this.entries.set(path, value);
  }
}