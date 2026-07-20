import type { RunIdFactory } from "../../src/ports/run-id.js";

export class FakeRunIdFactory implements RunIdFactory {
  private queue: string[] = [];

  constructor(initialRunIds: string[] = []) {
    this.queue = [...initialRunIds];
  }

  nextRunId(): string {
    const next = this.queue.shift();
    if (!next) {
      throw new Error("FakeRunIdFactory queue is empty");
    }
    return next;
  }

  enqueue(runIds: string[]): void {
    this.queue.push(...runIds);
  }
}
