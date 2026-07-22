import type { RetryControl } from "../../ports/retry.js";

export class SystemRetryControl implements RetryControl {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  jitterUnit(): number {
    return Math.random();
  }
}
