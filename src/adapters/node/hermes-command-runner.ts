import { execFile } from "node:child_process";

/**
 * Invoke the local `hermes` CLI. Separated from HermesLlmProvider so the
 * provider stays a pure unit under test and the subprocess boundary is the only
 * untested surface.
 */
export async function runHermesCommand(
  args: readonly string[],
  timeoutMs: number
): Promise<{ stdout: string; exitCode: number }> {
  return await new Promise((resolve, reject) => {
    execFile(
      "hermes",
      [...args],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          // ENOENT (hermes absent, as in CI) and timeouts both surface as
          // provider-unavailable so the caller fails closed to no brief.
          reject(new Error(error.message));
          return;
        }
        resolve({ stdout, exitCode: 0 });
      }
    );
  });
}
