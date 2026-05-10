export interface CommandRunner {
  run(command: string, args: string[]): Promise<void>;
}
