import { test, expect } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

test("deploy-live.sh re-executes itself to run new commands after git pull", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-live-test-"));
  const binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir);

  const logPath = path.join(tmpDir, "execution.log");

  // mock pnpm: fails if old command is executed
  fs.writeFileSync(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
echo "pnpm $@" >> "${logPath}"
if [[ "$1" == "cron:install" ]]; then
  echo "Command \\"cron:install\\" not found" >&2
  exit 254
fi
`
  );
  fs.chmodSync(path.join(binDir, "pnpm"), 0o755);

  const scriptPath = path.join(tmpDir, "deploy-live.sh");
  const realScriptPath = path.resolve(process.cwd(), "scripts/deploy-live.sh");
  const originalScript = fs.readFileSync(realScriptPath, "utf8");
  fs.writeFileSync(scriptPath, originalScript);
  fs.chmodSync(scriptPath, 0o755);

  // Update the pulled script to run NEW_COMMAND
  const updatedScript = originalScript.replace("cron:install", "cron:NEW_COMMAND");

  // mock git: replaces the script in place (simulating git pull replacing inode)
  const gitMock = `#!/usr/bin/env bash
echo "git pull --ff-only" >> "${logPath}"
cat << 'INNER' > "${scriptPath}.new"
${updatedScript}
INNER
chmod +x "${scriptPath}.new"
mv "${scriptPath}.new" "${scriptPath}"
`;
  fs.writeFileSync(path.join(binDir, "git"), gitMock);
  fs.chmodSync(path.join(binDir, "git"), 0o755);

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

  try {
    await execAsync(`bash "${scriptPath}"`, { env });
  } catch {
    // Catch command exit error on un-fixed script so assertion can cleanly evaluate log
  }

  const pnpmLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  expect(pnpmLog).toContain("pnpm cron:NEW_COMMAND");
});

test("deploy-live.sh skips git pull when --post-pull is passed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-live-test-"));
  const binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir);

  const logPath = path.join(tmpDir, "execution.log");

  // mock pnpm: log calls
  fs.writeFileSync(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
echo "pnpm $@" >> "${logPath}"
`
  );
  fs.chmodSync(path.join(binDir, "pnpm"), 0o755);

  // mock git: should NOT be called when --post-pull is passed
  fs.writeFileSync(
    path.join(binDir, "git"),
    `#!/usr/bin/env bash
echo "git $@" >> "${logPath}"
exit 1
`
  );
  fs.chmodSync(path.join(binDir, "git"), 0o755);

  const scriptPath = path.join(tmpDir, "deploy-live.sh");
  const realScriptPath = path.resolve(process.cwd(), "scripts/deploy-live.sh");
  const originalScript = fs.readFileSync(realScriptPath, "utf8");
  fs.writeFileSync(scriptPath, originalScript);
  fs.chmodSync(scriptPath, 0o755);

  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

  try {
    await execAsync(`bash "${scriptPath}" --post-pull`, { env });
  } catch {
    // Catch command exit error on un-fixed script when git pull fails
  }

  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  expect(log).not.toContain("git");
  expect(log).toContain("pnpm cron:install");
});
