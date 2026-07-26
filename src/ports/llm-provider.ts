import type { ZodSchema } from "zod";

export interface StructuredGenerationRequest<T> {
  readonly systemPrompt: string;
  readonly context: unknown;
  readonly schema: ZodSchema<T>;
  readonly schemaName: string;
  readonly timeoutMs?: number;
}

export interface StructuredGeneration<T> {
  readonly output: T;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string;
}

export interface LlmProvider {
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGeneration<T>>;
}
