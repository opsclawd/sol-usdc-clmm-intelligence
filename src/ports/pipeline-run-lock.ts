export interface PipelineRunLock {
  acquire(key: string): Promise<"acquired" | "already_running">;
  release(): Promise<void>;
}
