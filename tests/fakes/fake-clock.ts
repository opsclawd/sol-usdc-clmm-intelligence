import type { Clock } from "../../src/ports/clock.js";

export class FakeClock implements Clock {
  constructor(private value: string) {}
  now(): string {
    return this.value;
  }
  set(value: string): void {
    this.value = value;
  }
}
