export interface RetryControl {
  sleep(ms: number): Promise<void>;
  jitterUnit(): number;
}
