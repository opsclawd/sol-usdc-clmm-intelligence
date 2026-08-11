import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

async function makeFakeCommands(): Promise<{ bin: string; log: string }> {
  const directory = await mkdtemp(join(tmpdir(), "deploy-live-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  const log = join(directory, "commands.log");
  await mkdir(bin);

  const git = `#!/usr/bin/env bash
printf '%s\\n' "git $*" >> "$DEPLOY_LOG"
if [[ "\${DEPLOY_FAIL:-}" == "git" ]]; then exit 23; fi
`;
  const pnpm = `#!/usr/bin/env bash
printf '%s\\n' "pnpm $*" >> "$DEPLOY_LOG"
if [[ "\${DEPLOY_FAIL:-}" == "$1" ]]; then exit 23; fi
`;

  await Promise.all([writeFile(join(bin, "git"), git), writeFile(join(bin, "pnpm"), pnpm)]);
  await Promise.all([chmod(join(bin, "git"), 0o755), chmod(join(bin, "pnpm"), 0o755)]);
  return { bin, log };
}

async function runDeployment(failAt?: string) {
  const { bin, log } = await makeFakeCommands();
  const result = spawnSync("bash", ["scripts/deploy-live.sh"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      DEPLOY_LOG: log,
      ...(failAt == null ? {} : { DEPLOY_FAIL: failAt })
    }
  });
  const commands = (await readFile(log, "utf8")).trim().split("\n");
  return { result, commands };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("deploy-live", () => {
  it("runs pull, locked install, migration, and cron install in order", async () => {
    const { result, commands } = await runDeployment();
    expect(result.status).toBe(0);
    expect(commands).toEqual([
      "git pull --ff-only",
      "pnpm install --frozen-lockfile",
      "pnpm db:migrate",
      "pnpm cron:install"
    ]);
  });

  it("stops after checkout failure", async () => {
    const { result, commands } = await runDeployment("git");
    expect(result.status).toBe(23);
    expect(commands).toEqual(["git pull --ff-only"]);
  });

  it("stops after dependency installation failure", async () => {
    const { result, commands } = await runDeployment("install");
    expect(result.status).toBe(23);
    expect(commands).toEqual(["git pull --ff-only", "pnpm install --frozen-lockfile"]);
  });

  it("stops after migration failure before cron install", async () => {
    const { result, commands } = await runDeployment("db:migrate");
    expect(result.status).toBe(23);
    expect(commands).toEqual([
      "git pull --ff-only",
      "pnpm install --frozen-lockfile",
      "pnpm db:migrate"
    ]);
  });

  it("reports cron install failure after prior stages succeed", async () => {
    const { result, commands } = await runDeployment("cron:install");
    expect(result.status).toBe(23);
    expect(commands).toEqual([
      "git pull --ff-only",
      "pnpm install --frozen-lockfile",
      "pnpm db:migrate",
      "pnpm cron:install"
    ]);
  });

  it("maps deploy:live to the deployment script", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["deploy:live"]).toBe("bash scripts/deploy-live.sh");
  });
});
