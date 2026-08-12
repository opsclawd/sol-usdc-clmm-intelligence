import type { ZodType, ZodTypeDef } from "zod";

export interface StructuredGenerationRequest<T> {
  readonly systemPrompt: string;
  readonly context: unknown;
  /**
   * Input is `unknown` rather than `T`: a schema may legitimately preprocess
   * the model's reply before validating (see clampLlmBriefOutput). ZodSchema<T>
   * requires input and output to match, which excludes that.
   */
  readonly schema: ZodType<T, ZodTypeDef, unknown>;
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
