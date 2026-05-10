import "dotenv/config";
import type { EnvReader } from "../../ports/env.js";

export class ProcessEnvReader implements EnvReader {
  get(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
    if (value == null || value.length === 0) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  getOptional(name: string): string | undefined {
    const value = process.env[name];
    return value == null || value.length === 0 ? undefined : value;
  }
}
