/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { verifyPgConnection, verifyPgSchema, verifyTable } from "../../src/db/verify.js";

describe("verify helpers", () => {
  it("verifyPgConnection calls db.execute with SELECT 1", async () => {
    let executed = false;
    const mockDb = {
      execute: async () => {
        executed = true;
        return [{ result: 1 }];
      }
    } as any;
    await verifyPgConnection(mockDb);
    expect(executed).toBe(true);
  });

  it("verifyPgSchema throws when schema not found", async () => {
    const mockDb = {
      execute: async () => []
    } as any;
    await expect(verifyPgSchema(mockDb)).rejects.toThrow(
      "FATAL: intelligence schema not found in Postgres"
    );
  });

  it("verifyPgSchema succeeds when schema exists", async () => {
    const mockDb = {
      execute: async () => [{ nspname: "intelligence" }]
    } as any;
    await expect(verifyPgSchema(mockDb)).resolves.toBeUndefined();
  });

  it("verifyTable throws when table not found", async () => {
    const mockDb = {
      execute: async () => []
    } as any;
    await expect(verifyTable(mockDb, "raw_observations")).rejects.toThrow(
      "FATAL: raw_observations table not found in intelligence schema — run migrations first"
    );
  });

  it("verifyTable succeeds when table exists", async () => {
    const mockDb = {
      execute: async () => [{ tablename: "raw_observations" }]
    } as any;
    await expect(verifyTable(mockDb, "raw_observations")).resolves.toBeUndefined();
  });
});
