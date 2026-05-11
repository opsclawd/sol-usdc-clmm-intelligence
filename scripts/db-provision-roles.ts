import "dotenv/config";
import postgres from "postgres";

async function provisionRoles(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const sql = postgres(url, {
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false }
  });

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS intelligence`;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_reader') THEN
          CREATE ROLE intelligence_reader;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intelligence_writer') THEN
          CREATE ROLE intelligence_writer;
        END IF;
      END
      $$
    `;
    console.log("Provisioned intelligence_reader and intelligence_writer roles");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("must be superuser or have createrole privilege")
    ) {
      console.error(
        "Cannot create roles: current user lacks CREATEROLE privilege.\n" +
          "Ask your DBA to run: scripts/db-provision-roles.ts\n" +
          "Or run it with a superuser connection."
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await sql.end();
  }
}

provisionRoles().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
