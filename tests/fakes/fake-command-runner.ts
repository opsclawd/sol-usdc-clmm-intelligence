import type { CommandRunner } from '../../src/ports/command-runner.js';

export class FakeCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];
  shouldFailWith?: Error;

  async run(command: string, args: string[]): Promise<void> {
    this.calls.push({ command, args: [...args] });
    if (this.shouldFailWith) throw this.shouldFailWith;
  }
}