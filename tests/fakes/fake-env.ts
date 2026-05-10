import type { EnvReader } from "../../src/ports/env.js";

export class FakeEnv implements EnvReader {
  constructor(private readonly values: Record<string, string | undefined> = {}) {}

  set(name: string, value: string | undefined): void {
    this.values[name] = value;
  }

  get(name: string, fallback?: string): string {
    const value = this.values[name] ?? fallback;
    if (value == null || value.length === 0) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  getOptional(name: string): string | undefined {
    const value = this.values[name];
    return value == null || value.length === 0 ? undefined : value;
  }
}
