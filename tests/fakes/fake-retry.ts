import type { RetryControl } from "../../src/ports/retry.js";

export class FakeRetry implements RetryControl {
  private readonly sleepDelays: number[] = [];
  private readonly jitterValues: number[];
  private jitterIndex = 0;

  constructor(jitterValues: number[] = []) {
    this.jitterValues = jitterValues;
  }

  sleep(ms: number): Promise<void> {
    this.sleepDelays.push(ms);
    return Promise.resolve();
  }

  jitterUnit(): number {
    if (this.jitterIndex < this.jitterValues.length) {
      return this.jitterValues[this.jitterIndex++] ?? 0;
    }
    return 0;
  }

  get delays(): number[] {
    return [...this.sleepDelays];
  }
}
