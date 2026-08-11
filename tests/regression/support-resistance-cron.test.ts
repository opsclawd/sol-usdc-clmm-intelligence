import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface CronJob {
  name: string;
  cron: string;
  command: string;
}

interface CronConfig {
  jobs: CronJob[];
}

async function loadCronJobs(): Promise<{ jobs: CronJob[]; job: CronJob }> {
  const content = await readFile("cron/jobs.yaml", "utf8");
  const config = parse(content) as CronConfig;
  const matches = config.jobs.filter((j) => j.name === "support-resistance");
  if (matches.length !== 1) {
    throw new Error(`Expected exactly 1 support-resistance job, found ${matches.length}`);
  }
  return { jobs: config.jobs, job: matches[0]! };
}

async function loadRoutine(): Promise<string> {
  return await readFile("docs/collectors/support-resistance.md", "utf8");
}

describe("support-resistance cron schedule and routine regression", () => {
  it("schedules support resistance collection every four hours", async () => {
    const { job } = await loadCronJobs();
    expect(job.cron).toBe("15 */4 * * *");
  });

  it("points the schedule at the support resistance command", async () => {
    const { job } = await loadCronJobs();
    expect(job.command).toBe("pnpm collect:support-resistance");
  });

  it("runs exactly pnpm collect support resistance from the routine", async () => {
    const routine = await loadRoutine();
    expect(routine).toContain("`pnpm collect:support-resistance`");
  });

  it("documents collection freshness and non authority boundaries", async () => {
    const routine = await loadRoutine();
    // Cadence rationale
    expect(routine.toLowerCase()).toMatch(/four-hour|4-hour|4 hour|four hour/);
    // Expiry-aware / freshness language
    expect(routine.toLowerCase()).toMatch(/expiry|expires|freshness|stale/);
    // Non-authority / policy synthesis / transaction execution boundary
    expect(routine).toMatch(/policy/i);
    expect(routine).toMatch(/transaction/i);
    expect(routine).toMatch(/regime-engine|synthesize/i);
  });
});
