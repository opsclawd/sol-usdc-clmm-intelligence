import { spawn } from 'node:child_process';
import type { CommandRunner } from '../../ports/command-runner.js';

export class SpawnCommandRunner implements CommandRunner {
  run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }
}