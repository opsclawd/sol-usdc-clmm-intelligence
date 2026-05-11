import type { DbConnection } from "../../ports/db.js";
import { createDb } from "../../db/db.js";
import type { EnvReader } from "../../ports/env.js";

export class DrizzlePgAdapter implements DbConnection {
  public readonly db;
  private readonly client;

  constructor(env: EnvReader) {
    const connectionString = env.get("DATABASE_URL");
    const { db, client } = createDb(connectionString);
    this.db = db;
    this.client = client;
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
