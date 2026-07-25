import type {
  LlmProvider,
  StructuredGeneration,
  StructuredGenerationRequest
} from "../../src/ports/llm-provider.js";

type QueuedOutcome =
  | { type: "success"; generation: StructuredGeneration<unknown> }
  | { type: "error"; error: Error };

export class FakeLlmProvider implements LlmProvider {
  private readonly queue: QueuedOutcome[] = [];
  private readonly requests: StructuredGenerationRequest<unknown>[] = [];

  enqueueResult<T>(result: StructuredGeneration<T>): void {
    this.queue.push({ type: "success", generation: result });
  }

  enqueueError(error: Error): void {
    this.queue.push({ type: "error", error });
  }

  capturedRequests(): ReadonlyArray<StructuredGenerationRequest<unknown>> {
    return this.requests;
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGeneration<T>> {
    this.requests.push(request);

    const outcome = this.queue.shift();
    if (!outcome) {
      throw new Error("FakeLlmProvider queue is empty");
    }

    if (outcome.type === "error") {
      throw outcome.error;
    }

    return outcome.generation as StructuredGeneration<T>;
  }
}
