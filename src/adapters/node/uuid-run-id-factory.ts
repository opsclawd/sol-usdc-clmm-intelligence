import { randomUUID } from "node:crypto";
import type { RunIdFactory } from "../../ports/run-id.js";

export class UuidRunIdFactory implements RunIdFactory {
  nextRunId(): string {
    return randomUUID();
  }
}
