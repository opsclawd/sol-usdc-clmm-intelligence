import { describe, expect, it } from "vitest";
import { renderSystemCron } from "../../src/application/render-system-cron.js";

describe("renderSystemCron", () => {
  it("generates bounded system cron blocks", () => {
    const lines = renderSystemCron({
      defaults: {
        workingDirectory: "/opt/apps/test",
        timezone: "America/Edmonton",
        session: "test",
        exact: false
      },
      preparedJobs: [
        {
          job: { name: "job1", cron: "0 * * * *", command: "pnpm test", messageFile: "x.md" },
          message: "test message"
        }
      ]
    });
    expect(lines).toEqual([
      "# BEGIN SOL-USDC CRON",
      "0 * * * * cd /opt/apps/test && source .env && pnpm test >> cron/output/job1.log 2>&1",
      "# END SOL-USDC CRON"
    ]);
  });
});
