import { describe, it, expect, vi } from "vitest";
import { cleanupObservationRows } from "../../../src/adapters/node/dev-cleanup.js";
import type { DbConnection } from "../../../src/ports/db.js";

describe("cleanupObservationRows", () => {
  it("deletes rows matching given IDs using the drizzle database instance", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
    const fakeConn = {
      db: { delete: mockDelete },
      close: async () => {}
    } as unknown as DbConnection;

    await cleanupObservationRows(fakeConn, [10, 20, 10, 0, -1]);

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it("no-ops when empty or invalid IDs are passed", async () => {
    const mockDelete = vi.fn();
    const fakeConn = {
      db: { delete: mockDelete },
      close: async () => {}
    } as unknown as DbConnection;

    await cleanupObservationRows(fakeConn, [0, -5]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("throws error if connection has no db instance", async () => {
    const fakeConn = { close: async () => {} } as DbConnection;
    await expect(cleanupObservationRows(fakeConn, [10])).rejects.toThrow(
      /Unable to perform dev cleanup/
    );
  });
});
