import "dotenv/config";
import postgres from "postgres";

async function ensureSchema(): Promise<void> {
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
    console.log("Ensured intelligence schema exists");
  } finally {
    await sql.end();
  }
}

ensureSchema().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
