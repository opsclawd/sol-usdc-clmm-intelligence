import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): {
  db: Db;
  client: ReturnType<typeof postgres>;
} {
  const parsed = parseInt(process.env.PG_MAX_CONNECTIONS ?? "", 10);
  const max = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  const ssl = process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false };

  const client = postgres(connectionString, {
    connection: {
      search_path: "intelligence"
    },
    ssl,
    idle_timeout: 30,
    max_lifetime: 1800,
    connect_timeout: 10,
    max
  });

  const db = drizzle(client, { schema });

  return { db, client };
}
