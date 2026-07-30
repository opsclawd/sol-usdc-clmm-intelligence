import type { PipelineRunLock } from "../../src/ports/pipeline-run-lock.js";

type LockState = "idle" | "acquired" | "contended" | "released";

export class FakePipelineRunLock implements PipelineRunLock {
  public readonly acquireKeys: string[] = [];
  public releaseCalls = 0;
  public shouldContend = false;
  public acquireError: Error | null = null;
  public releaseError: Error | null = null;

  private state: LockState = "idle";

  async acquire(key: string): Promise<"acquired" | "already_running"> {
    if (!key || key.trim() === "") {
      throw new Error("Lock key must be a non-empty string");
    }
    if (this.state !== "idle") {
      throw new Error(`Cannot acquire lock: current state is '${this.state}'`);
    }

    this.acquireKeys.push(key);

    if (this.acquireError) {
      this.state = "contended";
      throw this.acquireError;
    }

    if (this.shouldContend) {
      this.state = "contended";
      return "already_running";
    }

    this.state = "acquired";
    return "acquired";
  }

  async release(): Promise<void> {
    this.releaseCalls++;

    if (this.state !== "acquired") {
      throw new Error(`Cannot release lock: current state is '${this.state}'`);
    }

    if (this.releaseError) {
      this.state = "released";
      throw this.releaseError;
    }

    this.state = "released";
  }
}
