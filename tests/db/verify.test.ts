/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import {
  verifyPgConnection,
  verifyPgSchema,
  verifyTable,
  verifyForeignKey
} from "../../src/db/verify.js";

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

  it("verifyForeignKey throws when constraint not found", async () => {
    const mockDb = {
      execute: async () => []
    } as any;
    await expect(
      verifyForeignKey(mockDb, "fk_normalized_observations_raw_observation")
    ).rejects.toThrow(
      "FATAL: FK constraint fk_normalized_observations_raw_observation not found — run migrations first"
    );
  });

  it("verifyForeignKey throws when constraint is not deferrable initially deferred", async () => {
    const mockDb = {
      execute: async () => [{ conname: "fk_test", condeferrable: false, condeferred: false }]
    } as any;
    await expect(verifyForeignKey(mockDb, "fk_test")).rejects.toThrow(
      "FATAL: FK constraint fk_test exists but is not DEFERRABLE INITIALLY DEFERRED"
    );
  });

  it("verifyForeignKey succeeds for deferrable initially deferred constraint", async () => {
    const mockDb = {
      execute: async () => [{ conname: "fk_test", condeferrable: true, condeferred: true }]
    } as any;
    await expect(verifyForeignKey(mockDb, "fk_test")).resolves.toBeUndefined();
  });
});
