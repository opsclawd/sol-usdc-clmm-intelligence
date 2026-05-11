import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false }
  },
  migrations: {
    table: "intelligence_migrations",
    schema: "intelligence"
  }
});
