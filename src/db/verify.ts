import { sql } from "drizzle-orm/sql";
import type { Db } from "./db.js";

export async function verifyPgConnection(db: Db): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

export async function verifyPgSchema(db: Db): Promise<void> {
  const result = await db.execute(
    sql`SELECT nspname FROM pg_namespace WHERE nspname = 'intelligence'`
  );
  if (result.length === 0) {
    throw new Error("FATAL: intelligence schema not found in Postgres");
  }
}

export async function verifyTable(db: Db, tableName: string): Promise<void> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'intelligence' AND tablename = ${tableName}`
  );
  if (result.length === 0) {
    throw new Error(
      `FATAL: ${tableName} table not found in intelligence schema — run migrations first`
    );
  }
}

export interface FkVerificationResult {
  name: string;
  deferrable: boolean;
  deferred: boolean;
}

export async function verifyForeignKey(
  db: Db,
  constraintName: string
): Promise<FkVerificationResult> {
  const result = await db.execute(
    sql`SELECT conname, condeferrable, condeferred FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = ${constraintName} AND n.nspname = 'intelligence'`
  );
  if (result.length === 0) {
    throw new Error(`FATAL: FK constraint ${constraintName} not found — run migrations first`);
  }
  const row = result[0] as { conname: string; condeferrable: boolean; condeferred: boolean };
  return {
    name: row.conname,
    deferrable: row.condeferrable,
    deferred: row.condeferred
  };
}
