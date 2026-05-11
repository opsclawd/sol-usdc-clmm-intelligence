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
